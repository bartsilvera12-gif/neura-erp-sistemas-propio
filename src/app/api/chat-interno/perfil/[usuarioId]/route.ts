import { NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { firmarAvatares, nombreVisible, requireChatInterno, respuestaAuth } from "@/lib/chat-interno/core";
import { fetchJefesExtra } from "@/lib/organigrama/jefes-service";
import { resolverPorNombre, type UsuarioEmpresa } from "@/lib/organigrama/vincular-usuario";

export const runtime = "nodejs";

/** Hace cuánto se considera "en línea": el chat marca leído cada ~20 s mientras está abierto. */
const EN_LINEA_MS = 2 * 60 * 1000;

type Nodo = {
  id: string;
  parent_id: string | null;
  titulo: string;
  nombre_persona: string | null;
  usuario_id: string | null;
};

type Usuario = UsuarioEmpresa & {
  avatar_path: string | null;
  area: string | null;
  cumple_mes?: number | null;
  cumple_dia?: number | null;
  banner_color?: string | null;
  banner_path?: string | null;
};

type Persona = { usuario_id: string | null; nombre: string; cargo: string; avatar_url: string | null };

/**
 * GET — el perfil de alguien de mi empresa, para el modal del chat: foto, banner, cargo,
 * supervisor y equipo (del organigrama), cumpleaños, área y última actividad.
 */
export async function GET(request: Request, { params }: { params: Promise<{ usuarioId: string }> }) {
  const auth = await requireChatInterno(request);
  if (!auth.ok) return respuestaAuth(auth);
  const { sb, empresaId, usuarioId: yo } = auth;
  const { usuarioId } = await params;

  try {
    const catalog = createServiceRoleClient();
    const { data: base } = await catalog
      .from("usuarios")
      .select("id, nombre, nombre_chat, avatar_path, area")
      .eq("empresa_id", empresaId);
    const usuarios = (base ?? []) as Usuario[];
    const u = usuarios.find((x) => x.id === usuarioId);
    // Sólo gente de mi empresa: el id viene de la URL.
    if (!u) return NextResponse.json(errorResponse("Usuario no encontrado"), { status: 404 });

    // Columnas opcionales aparte: si el SQL todavía no corrió, el perfil sale igual sin ellas.
    const { data: extra, error: eExtra } = await catalog
      .from("usuarios")
      .select("cumple_mes, cumple_dia, banner_color, banner_path")
      .eq("id", usuarioId)
      .maybeSingle();
    const ex = (eExtra ? {} : extra ?? {}) as Partial<Usuario>;

    // ── Organigrama ──
    const { data: nodosData } = await sb
      .from("organigrama_nodos")
      .select("id, parent_id, titulo, nombre_persona, usuario_id")
      .eq("empresa_id", empresaId);
    const nodos = (nodosData ?? []) as Nodo[];
    const porId = new Map(nodos.map((n) => [n.id, n]));
    const personaDe = (n: Nodo): string | null => n.usuario_id ?? resolverPorNombre(n.nombre_persona, usuarios);
    const tienePersona = (n: Nodo) => !!(n.usuario_id || n.nombre_persona?.trim());
    const miNodo = nodos.find((n) => personaDe(n) === usuarioId) ?? null;
    const jefesExtra = miNodo
      ? await fetchJefesExtra(sb, empresaId).catch(() => new Map<string, string[]>())
      : new Map<string, string[]>();

    // El jefe de un puesto es el primer puesto de arriba que tiene a alguien: un puesto vacío
    // ("Supervisor Soporte" sin persona) no puede ser el supervisor de nadie.
    const subirHastaPersona = (id: string | null): Nodo | null => {
      let actual = id ? porId.get(id) ?? null : null;
      const vistos = new Set<string>();
      while (actual && !tienePersona(actual) && !vistos.has(actual.id)) {
        vistos.add(actual.id);
        actual = actual.parent_id ? porId.get(actual.parent_id) ?? null : null;
      }
      return actual;
    };
    const supervisoresNodos: Nodo[] = [];
    if (miNodo) {
      for (const id of [miNodo.parent_id, ...(jefesExtra.get(miNodo.id) ?? [])]) {
        const j = subirHastaPersona(id);
        if (j && !supervisoresNodos.some((x) => x.id === j.id)) supervisoresNodos.push(j);
      }
    }
    // Su equipo: los de abajo, atravesando los puestos vacíos.
    const equipoNodos: Nodo[] = [];
    if (miNodo) {
      const cola = nodos.filter((n) => n.parent_id === miNodo.id);
      const vistos = new Set<string>();
      while (cola.length) {
        const n = cola.shift()!;
        if (vistos.has(n.id)) continue;
        vistos.add(n.id);
        if (tienePersona(n)) equipoNodos.push(n);
        else cola.push(...nodos.filter((h) => h.parent_id === n.id));
      }
    }

    const avatarIds = new Set<string>([usuarioId]);
    for (const n of [...supervisoresNodos, ...equipoNodos]) {
      const p = personaDe(n);
      if (p) avatarIds.add(p);
    }
    const avatares = await firmarAvatares(
      sb,
      usuarios.filter((x) => avatarIds.has(x.id))
    );
    const bannerUrl = ex.banner_path
      ? (await firmarAvatares(sb, [{ id: "banner", avatar_path: ex.banner_path }])).get("banner") ?? null
      : null;

    const aPersona = (n: Nodo): Persona => {
      const pid = personaDe(n);
      const pu = pid ? usuarios.find((x) => x.id === pid) : undefined;
      return {
        usuario_id: pid,
        nombre: pu ? nombreVisible(pu) : (n.nombre_persona ?? "").trim(),
        cargo: n.titulo,
        avatar_url: pid ? avatares.get(pid) ?? null : null,
      };
    };

    // ── Última actividad: lo último que escribió o leyó en el chat ──
    const [{ data: ultMsg }, { data: ultLect }] = await Promise.all([
      sb
        .from("chat_interno_mensajes")
        .select("created_at")
        .eq("usuario_id", usuarioId)
        .order("created_at", { ascending: false })
        .limit(1),
      sb
        .from("chat_interno_miembros")
        .select("ultima_lectura_at")
        .eq("usuario_id", usuarioId)
        .order("ultima_lectura_at", { ascending: false, nullsFirst: false })
        .limit(1),
    ]);
    const fechas = [
      (ultMsg as { created_at?: string }[] | null)?.[0]?.created_at,
      (ultLect as { ultima_lectura_at?: string | null }[] | null)?.[0]?.ultima_lectura_at,
    ].filter((x): x is string => !!x);
    const ultimaActividad = fechas.sort().at(-1) ?? null;
    const enLinea = usuarioId === yo || (!!ultimaActividad && Date.now() - Date.parse(ultimaActividad) < EN_LINEA_MS);

    return NextResponse.json(
      successResponse({
        usuario_id: u.id,
        propio: u.id === yo,
        nombre: nombreVisible(u),
        nombre_completo: (u.nombre ?? "").trim(),
        avatar_url: avatares.get(u.id) ?? null,
        banner_color: ex.banner_color ?? null,
        banner_url: bannerUrl,
        area: (u.area ?? "").trim() || null,
        cumple_mes: ex.cumple_mes ?? null,
        cumple_dia: ex.cumple_dia ?? null,
        cumple_disponible: !eExtra,
        cargo: miNodo?.titulo ?? null,
        supervisores: supervisoresNodos.map(aPersona),
        equipo: equipoNodos.map(aPersona),
        en_linea: enLinea,
        ultima_actividad: ultimaActividad,
      })
    );
  } catch (e) {
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "No se pudo cargar el perfil"),
      { status: 500 }
    );
  }
}
