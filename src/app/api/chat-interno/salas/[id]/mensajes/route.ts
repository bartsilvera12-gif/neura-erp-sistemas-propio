import { NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import {
  esMiembro,
  firmarAdjuntos,
  requireChatInterno,
  respuestaAuth,
  type ChatAdjunto,
} from "@/lib/chat-interno/core";

export const runtime = "nodejs";

const PAGINA = 50;

/** GET — mensajes de la sala, del más nuevo al más viejo, paginado por `antes_de`. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireChatInterno(request);
  if (!auth.ok) return respuestaAuth(auth);
  const { sb, usuarioId } = auth;
  const { id: salaId } = await params;

  try {
    const { miembro } = await esMiembro(sb, salaId, usuarioId);
    if (!miembro) return NextResponse.json(errorResponse("No sos miembro de esta sala"), { status: 403 });

    const antesDe = new URL(request.url).searchParams.get("antes_de");
    let q = sb
      .from("chat_interno_mensajes")
      .select("id, usuario_id, texto, adjuntos, created_at, editado_at, eliminado_at")
      .eq("sala_id", salaId)
      .order("created_at", { ascending: false })
      .limit(PAGINA);
    if (antesDe) q = q.lt("created_at", antesDe);

    const { data, error } = await q;
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    const filas = (data ?? []) as Record<string, unknown>[];
    const catalog = createServiceRoleClient();
    const ids = [...new Set(filas.map((m) => m.usuario_id).filter((x): x is string => typeof x === "string"))];
    const { data: usuarios } = ids.length
      ? await catalog.from("usuarios").select("id, nombre").in("id", ids)
      : { data: [] as { id: string; nombre: string | null }[] };
    const nombreDe = new Map(
      ((usuarios ?? []) as { id: string; nombre: string | null }[]).map((u) => [u.id, u.nombre ?? "—"])
    );

    const urls = await firmarAdjuntos(sb, filas as { adjuntos?: unknown }[]);

    const mensajes = filas
      .map((m) => {
        const adjuntos = Array.isArray(m.adjuntos) ? (m.adjuntos as ChatAdjunto[]) : [];
        const borrado = m.eliminado_at != null;
        return {
          id: String(m.id),
          usuario_id: (m.usuario_id as string | null) ?? null,
          autor: m.usuario_id ? nombreDe.get(String(m.usuario_id)) ?? "—" : "—",
          // Un mensaje borrado deja el hueco pero no el contenido.
          texto: borrado ? null : ((m.texto as string | null) ?? null),
          adjuntos: borrado
            ? []
            : adjuntos.map((a) => ({ ...a, url: urls.get(a.path) ?? null })),
          created_at: String(m.created_at),
          editado_at: (m.editado_at as string | null) ?? null,
          eliminado: borrado,
          propio: m.usuario_id === usuarioId,
        };
      })
      .reverse();

    return NextResponse.json(
      successResponse({ mensajes, hay_mas: filas.length === PAGINA })
    );
  } catch (e) {
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "No se pudieron cargar los mensajes"),
      { status: 500 }
    );
  }
}

/** POST — publica un mensaje. Texto, adjuntos, o las dos cosas. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireChatInterno(request);
  if (!auth.ok) return respuestaAuth(auth);
  const { sb, empresaId, usuarioId } = auth;
  const { id: salaId } = await params;

  try {
    const { miembro } = await esMiembro(sb, salaId, usuarioId);
    if (!miembro) return NextResponse.json(errorResponse("No sos miembro de esta sala"), { status: 403 });

    const body = (await request.json().catch(() => ({}))) as {
      texto?: string;
      adjuntos?: ChatAdjunto[];
    };
    const texto = (body.texto ?? "").trim();
    const adjuntos = Array.isArray(body.adjuntos)
      ? body.adjuntos.filter((a) => a && typeof a.path === "string" && a.path.startsWith(`${empresaId}/${salaId}/`))
      : [];

    if (!texto && adjuntos.length === 0) {
      return NextResponse.json(errorResponse("Escribí algo o adjuntá un archivo"), { status: 400 });
    }

    const { data, error } = await sb
      .from("chat_interno_mensajes")
      .insert({
        empresa_id: empresaId,
        sala_id: salaId,
        usuario_id: usuarioId,
        texto: texto || null,
        ...(adjuntos.length > 0 ? { adjuntos } : {}),
      })
      .select("id, created_at")
      .single();
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    const creado = data as { id: string; created_at: string };
    // La bandeja ordena por esto; se actualiza acá y no con un trigger para que
    // el orden ya esté bien en la misma respuesta.
    await sb
      .from("chat_interno_salas")
      .update({ ultimo_mensaje_at: creado.created_at, updated_at: creado.created_at })
      .eq("id", salaId)
      .eq("empresa_id", empresaId);

    // Quien escribe ya leyó lo suyo.
    await sb
      .from("chat_interno_miembros")
      .update({ ultima_lectura_at: creado.created_at })
      .eq("sala_id", salaId)
      .eq("usuario_id", usuarioId);

    return NextResponse.json(successResponse({ id: creado.id }), { status: 201 });
  } catch (e) {
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "No se pudo enviar"),
      { status: 500 }
    );
  }
}
