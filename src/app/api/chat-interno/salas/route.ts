import { NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { requireChatInterno, respuestaAuth } from "@/lib/chat-interno/core";

export const runtime = "nodejs";

/**
 * GET  — mis salas, con el último mensaje y cuántos no leí.
 * POST — crea un grupo, o abre la conversación directa con alguien.
 */
export async function GET(request: Request) {
  const auth = await requireChatInterno(request);
  if (!auth.ok) return respuestaAuth(auth);
  const { sb, empresaId, usuarioId } = auth;

  try {
    const { data: mis } = await sb
      .from("chat_interno_miembros")
      .select("sala_id, ultima_lectura_at")
      .eq("usuario_id", usuarioId);

    const filas = (mis ?? []) as { sala_id: string; ultima_lectura_at: string | null }[];
    if (filas.length === 0) return NextResponse.json(successResponse({ salas: [] }));

    const ids = filas.map((f) => f.sala_id);
    const lecturaDe = new Map(filas.map((f) => [f.sala_id, f.ultima_lectura_at]));

    const [{ data: salas }, { data: miembros }, { data: ultimos }] = await Promise.all([
      sb
        .from("chat_interno_salas")
        .select("id, tipo, nombre, descripcion, ultimo_mensaje_at, created_at")
        .eq("empresa_id", empresaId)
        .in("id", ids)
        .order("ultimo_mensaje_at", { ascending: false, nullsFirst: false }),
      sb.from("chat_interno_miembros").select("sala_id, usuario_id").in("sala_id", ids),
      // Sólo lo necesario para la vista previa de la bandeja.
      sb
        .from("chat_interno_mensajes")
        .select("sala_id, texto, adjuntos, created_at, usuario_id")
        .in("sala_id", ids)
        .is("eliminado_at", null)
        .order("created_at", { ascending: false })
        .limit(400),
    ]);

    const catalog = createServiceRoleClient();
    const idsUsuarios = [
      ...new Set(((miembros ?? []) as { usuario_id: string }[]).map((m) => m.usuario_id)),
    ];
    const { data: usuarios } = idsUsuarios.length
      ? await catalog.from("usuarios").select("id, nombre").in("id", idsUsuarios)
      : { data: [] as { id: string; nombre: string | null }[] };
    const nombreDe = new Map(
      ((usuarios ?? []) as { id: string; nombre: string | null }[]).map((u) => [u.id, u.nombre ?? "—"])
    );

    const porSala = new Map<string, string[]>();
    for (const m of (miembros ?? []) as { sala_id: string; usuario_id: string }[]) {
      porSala.set(m.sala_id, [...(porSala.get(m.sala_id) ?? []), m.usuario_id]);
    }

    type Msg = {
      sala_id: string;
      texto: string | null;
      adjuntos: unknown;
      created_at: string;
      usuario_id: string | null;
    };
    const mensajes = (ultimos ?? []) as Msg[];
    const ultimoDe = new Map<string, Msg>();
    const noLeidos = new Map<string, number>();
    for (const m of mensajes) {
      if (!ultimoDe.has(m.sala_id)) ultimoDe.set(m.sala_id, m);
      const leidoHasta = lecturaDe.get(m.sala_id);
      // Lo propio nunca cuenta como no leído.
      if (m.usuario_id === usuarioId) continue;
      if (!leidoHasta || m.created_at > leidoHasta) {
        noLeidos.set(m.sala_id, (noLeidos.get(m.sala_id) ?? 0) + 1);
      }
    }

    const salida = ((salas ?? []) as Record<string, unknown>[]).map((s) => {
      const id = String(s.id);
      const integrantes = porSala.get(id) ?? [];
      const ultimo = ultimoDe.get(id);
      // La conversación directa se nombra sola con la otra persona: pedirle un
      // nombre al usuario sería ruido.
      const otro = integrantes.find((u) => u !== usuarioId);
      const nombre =
        s.tipo === "directo" ? nombreDe.get(otro ?? "") ?? "Conversación" : String(s.nombre ?? "Grupo");
      const adj = Array.isArray(ultimo?.adjuntos) ? (ultimo?.adjuntos as unknown[]) : [];
      return {
        id,
        tipo: String(s.tipo ?? "grupo"),
        nombre,
        descripcion: s.descripcion ?? null,
        miembros: integrantes.length,
        miembros_nombres: integrantes.map((u) => nombreDe.get(u) ?? "—"),
        ultimo_mensaje_at: s.ultimo_mensaje_at ?? null,
        no_leidos: noLeidos.get(id) ?? 0,
        vista_previa: ultimo
          ? (ultimo.texto ?? "").trim() || (adj.length > 0 ? "Archivo adjunto" : "")
          : "",
        vista_previa_autor: ultimo?.usuario_id ? nombreDe.get(ultimo.usuario_id) ?? "" : "",
      };
    });

    return NextResponse.json(successResponse({ salas: salida }));
  } catch (e) {
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "No se pudieron cargar las salas"),
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireChatInterno(request);
  if (!auth.ok) return respuestaAuth(auth);
  const { sb, empresaId, usuarioId } = auth;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      tipo?: string;
      nombre?: string;
      descripcion?: string;
      miembros?: string[];
    };
    const tipo = body.tipo === "directo" ? "directo" : "grupo";
    const invitados = [
      ...new Set((body.miembros ?? []).filter((m) => typeof m === "string" && m && m !== usuarioId)),
    ];

    if (tipo === "grupo" && !(body.nombre ?? "").trim()) {
      return NextResponse.json(errorResponse("El grupo necesita un nombre"), { status: 400 });
    }
    if (tipo === "directo" && invitados.length !== 1) {
      return NextResponse.json(errorResponse("Una conversación directa es con una sola persona"), {
        status: 400,
      });
    }

    // Sólo se puede hablar con gente de la MISMA empresa: el id viene del body.
    if (invitados.length > 0) {
      const catalog = createServiceRoleClient();
      const { data: validos } = await catalog
        .from("usuarios")
        .select("id")
        .eq("empresa_id", empresaId)
        .in("id", invitados);
      const ok = new Set(((validos ?? []) as { id: string }[]).map((u) => u.id));
      if (invitados.some((i) => !ok.has(i))) {
        return NextResponse.json(errorResponse("Hay usuarios que no son de tu empresa"), {
          status: 400,
        });
      }
    }

    // Un directo con la misma persona se reusa: dos hilos con alguien parten la
    // conversación y siempre se contesta en el equivocado.
    if (tipo === "directo") {
      const { data: mias } = await sb
        .from("chat_interno_miembros")
        .select("sala_id")
        .eq("usuario_id", usuarioId);
      const idsMios = ((mias ?? []) as { sala_id: string }[]).map((m) => m.sala_id);
      if (idsMios.length > 0) {
        const { data: suyas } = await sb
          .from("chat_interno_miembros")
          .select("sala_id")
          .eq("usuario_id", invitados[0])
          .in("sala_id", idsMios);
        const comunes = ((suyas ?? []) as { sala_id: string }[]).map((m) => m.sala_id);
        if (comunes.length > 0) {
          const { data: yaExiste } = await sb
            .from("chat_interno_salas")
            .select("id")
            .eq("tipo", "directo")
            .in("id", comunes)
            .limit(1)
            .maybeSingle();
          const existente = (yaExiste as { id?: string } | null)?.id;
          if (existente) return NextResponse.json(successResponse({ id: existente, reusada: true }));
        }
      }
    }

    const { data: sala, error } = await sb
      .from("chat_interno_salas")
      .insert({
        empresa_id: empresaId,
        tipo,
        nombre: tipo === "grupo" ? (body.nombre ?? "").trim() : null,
        descripcion: (body.descripcion ?? "").trim() || null,
        creado_por: usuarioId,
      })
      .select("id")
      .single();
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    const salaId = (sala as { id: string }).id;
    // Quien crea queda como admin de la sala: alguien tiene que poder sumar y
    // sacar gente sin depender de un rol global.
    const filas = [
      { sala_id: salaId, usuario_id: usuarioId, rol: "admin" },
      ...invitados.map((u) => ({ sala_id: salaId, usuario_id: u, rol: "miembro" })),
    ];
    const { error: eM } = await sb.from("chat_interno_miembros").insert(filas);
    if (eM) return NextResponse.json(errorResponse(eM.message), { status: 400 });

    return NextResponse.json(successResponse({ id: salaId, reusada: false }), { status: 201 });
  } catch (e) {
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "No se pudo crear la sala"),
      { status: 500 }
    );
  }
}
