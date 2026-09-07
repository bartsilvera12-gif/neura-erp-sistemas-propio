import { NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { notificarMensajeChat } from "@/lib/chat-interno/notificar";
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

    const sp = new URL(request.url).searchParams;
    const antesDe = sp.get("antes_de");
    const busca = (sp.get("q") ?? "").trim();

    let q = sb
      .from("chat_interno_mensajes")
      .select(
        "id, usuario_id, texto, adjuntos, created_at, editado_at, eliminado_at, responde_a, reacciones, menciones"
      )
      .eq("sala_id", salaId)
      .order("created_at", { ascending: false })
      .limit(PAGINA);
    if (antesDe) q = q.lt("created_at", antesDe);
    // Buscar es otra vista de la misma conversación: se filtra por texto y se
    // ignora la paginación por fecha, que responde a otra pregunta.
    if (busca) q = sb
      .from("chat_interno_mensajes")
      .select(
        "id, usuario_id, texto, adjuntos, created_at, editado_at, eliminado_at, responde_a, reacciones, menciones"
      )
      .eq("sala_id", salaId)
      .is("eliminado_at", null)
      .ilike("texto", `%${busca.replace(/[%_]/g, "")}%`)
      .order("created_at", { ascending: false })
      .limit(PAGINA);

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

    // Los mensajes citados pueden estar fuera de esta página: se traen aparte,
    // sólo con lo que hace falta para pintar la cita.
    const citados = [
      ...new Set(filas.map((m) => m.responde_a).filter((x): x is string => typeof x === "string")),
    ];
    const { data: originales } = citados.length
      ? await sb
          .from("chat_interno_mensajes")
          .select("id, usuario_id, texto, eliminado_at")
          .in("id", citados)
      : { data: [] as Record<string, unknown>[] };
    const citaDe = new Map(
      ((originales ?? []) as Record<string, unknown>[]).map((o) => [
        String(o.id),
        {
          autor: o.usuario_id ? nombreDe.get(String(o.usuario_id)) ?? "—" : "—",
          texto: o.eliminado_at ? null : ((o.texto as string | null) ?? null),
        },
      ])
    );

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
          responde_a: (m.responde_a as string | null) ?? null,
          cita: m.responde_a ? citaDe.get(String(m.responde_a)) ?? null : null,
          reacciones: (m.reacciones as Record<string, string[]> | null) ?? {},
          menciones: Array.isArray(m.menciones) ? (m.menciones as string[]) : [],
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
      responde_a?: string;
      menciones?: string[];
    };
    const texto = (body.texto ?? "").trim();
    const adjuntos = Array.isArray(body.adjuntos)
      ? body.adjuntos.filter((a) => a && typeof a.path === "string" && a.path.startsWith(`${empresaId}/${salaId}/`))
      : [];

    if (!texto && adjuntos.length === 0) {
      return NextResponse.json(errorResponse("Escribí algo o adjuntá un archivo"), { status: 400 });
    }

    // Sólo se cita un mensaje de ESTA sala: con el id de otro se podría filtrar
    // texto ajeno dentro de una conversación donde no corresponde.
    let respondeA: string | null = null;
    if (typeof body.responde_a === "string" && body.responde_a) {
      const { data: orig } = await sb
        .from("chat_interno_mensajes")
        .select("id")
        .eq("id", body.responde_a)
        .eq("sala_id", salaId)
        .maybeSingle();
      respondeA = (orig as { id?: string } | null)?.id ?? null;
    }

    // Sólo se menciona a miembros de la sala: a los demás el aviso los llevaría
    // a una conversación que no pueden abrir.
    let menciones: string[] = [];
    const pedidas = Array.isArray(body.menciones)
      ? [...new Set(body.menciones.filter((m): m is string => typeof m === "string" && !!m))]
      : [];
    if (pedidas.length > 0) {
      const { data: miembros } = await sb
        .from("chat_interno_miembros")
        .select("usuario_id")
        .eq("sala_id", salaId);
      const enSala = new Set(((miembros ?? []) as { usuario_id: string }[]).map((m) => m.usuario_id));
      menciones = pedidas.filter((m) => enSala.has(m) && m !== usuarioId);
    }

    const { data, error } = await sb
      .from("chat_interno_mensajes")
      .insert({
        empresa_id: empresaId,
        sala_id: salaId,
        usuario_id: usuarioId,
        texto: texto || null,
        ...(adjuntos.length > 0 ? { adjuntos } : {}),
        ...(respondeA ? { responde_a: respondeA } : {}),
        ...(menciones.length > 0 ? { menciones } : {}),
      })
      .select("id, created_at")
      .single();
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    const creado = data as { id: string; created_at: string };

    // Todo lo que sigue es independiente entre sí, así que va junto: en serie
    // eran cuatro viajes a la base antes de contestar, y escribir se sentía
    // lento por trabajo que a quien escribe no le importa esperar.
    const catalog2 = createServiceRoleClient();
    const [, , salaRes, yoRes] = await Promise.all([
      // La bandeja ordena por esto; se actualiza acá y no con un trigger para
      // que el orden ya esté bien en la misma respuesta.
      sb
        .from("chat_interno_salas")
        .update({ ultimo_mensaje_at: creado.created_at, updated_at: creado.created_at })
        .eq("id", salaId)
        .eq("empresa_id", empresaId),
      // Quien escribe ya leyó lo suyo.
      sb
        .from("chat_interno_miembros")
        .update({ ultima_lectura_at: creado.created_at })
        .eq("sala_id", salaId)
        .eq("usuario_id", usuarioId),
      sb.from("chat_interno_salas").select("nombre, tipo").eq("id", salaId).maybeSingle(),
      catalog2.from("usuarios").select("nombre").eq("id", usuarioId).maybeSingle(),
    ]);
    const sala = salaRes.data;
    const yo = yoRes.data;

    // El aviso va al final y no bloquea: el mensaje ya está guardado.
    await notificarMensajeChat(sb, {
      empresaId,
      salaId,
      salaNombre: String((sala as { nombre?: string } | null)?.nombre ?? "Chat"),
      salaTipo: String((sala as { tipo?: string } | null)?.tipo ?? "grupo"),
      autorId: usuarioId,
      autorNombre: String((yo as { nombre?: string } | null)?.nombre ?? "Alguien"),
      texto,
      menciones,
    });

    return NextResponse.json(successResponse({ id: creado.id }), { status: 201 });
  } catch (e) {
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "No se pudo enviar"),
      { status: 500 }
    );
  }
}
