import { NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import {
  esMiembro,
  firmarAdjuntos,
  nombreVisible,
  requireChatInterno,
  respuestaAuth,
  type ChatAdjunto,
} from "@/lib/chat-interno/core";

export const runtime = "nodejs";

/**
 * Todo lo que se compartió en la sala: imágenes, audios, documentos y enlaces.
 *
 * Se arma leyendo los mensajes en vez de guardarse en una tabla aparte porque
 * el mensaje ya es la fuente de verdad — si se borra un mensaje, lo que pasó
 * por él deja de estar compartido, sin ningún índice que mantener sincronizado.
 */

/** Techo alto pero techo: una sala vieja no puede convertir esto en un scan sin fin. */
const MAX_MENSAJES = 800;

/**
 * URLs dentro del texto. Deliberadamente sólo `http(s)://…`: sin esa exigencia
 * cualquier "algo.com" suelto en una frase entraría como enlace.
 */
const RE_URL = /https?:\/\/[^\s<>"')\]]+/gi;

function dominioDe(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 40);
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireChatInterno(request);
  if (!auth.ok) return respuestaAuth(auth);
  const { sb, usuarioId } = auth;
  const { id: salaId } = await params;

  try {
    const { miembro } = await esMiembro(sb, salaId, usuarioId);
    if (!miembro) {
      return NextResponse.json(errorResponse("No sos miembro de esta sala"), { status: 403 });
    }

    const { data, error } = await sb
      .from("chat_interno_mensajes")
      .select("id, usuario_id, texto, adjuntos, created_at")
      .eq("sala_id", salaId)
      .is("eliminado_at", null)
      .order("created_at", { ascending: false })
      .limit(MAX_MENSAJES);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    const filas = (data ?? []) as Record<string, unknown>[];

    const catalog = createServiceRoleClient();
    const ids = [
      ...new Set(filas.map((m) => m.usuario_id).filter((x): x is string => typeof x === "string")),
    ];
    const { data: usuarios } = ids.length
      ? await catalog.from("usuarios").select("id, nombre, nombre_chat").in("id", ids)
      : { data: [] as { id: string; nombre: string | null; nombre_chat: string | null }[] };
    const nombreDe = new Map(
      ((usuarios ?? []) as { id: string; nombre: string | null; nombre_chat: string | null }[]).map(
        (u) => [u.id, nombreVisible(u)]
      )
    );

    const urls = await firmarAdjuntos(sb, filas as { adjuntos?: unknown }[]);

    const imagenes: unknown[] = [];
    const audios: unknown[] = [];
    const archivos: unknown[] = [];
    const enlaces: unknown[] = [];

    for (const m of filas) {
      const autor = m.usuario_id ? nombreDe.get(String(m.usuario_id)) ?? "—" : "—";
      const cuando = String(m.created_at);

      for (const a of Array.isArray(m.adjuntos) ? (m.adjuntos as ChatAdjunto[]) : []) {
        if (!a?.path) continue;
        const item = {
          path: a.path,
          nombre: a.nombre,
          mime_type: a.mime_type,
          size_bytes: a.size_bytes,
          url: urls.get(a.path) ?? null,
          autor,
          created_at: cuando,
          mensaje_id: String(m.id),
        };
        // Se clasifica por el mime y no por la `clase` guardada: los videos
        // se subieron cuando esa categoría todavía no existía, y quedaron como
        // "archivo". Deducirlo acá los acomoda sin reescribir nada.
        const mime = (a.mime_type ?? "").toLowerCase();
        if (mime.startsWith("image/") || mime.startsWith("video/")) imagenes.push(item);
        else if (mime.startsWith("audio/")) audios.push(item);
        else archivos.push(item);
      }

      const texto = typeof m.texto === "string" ? m.texto : "";
      // Un mismo enlace repetido en el mismo mensaje se cuenta una vez.
      for (const url of new Set(texto.match(RE_URL) ?? [])) {
        enlaces.push({
          url,
          dominio: dominioDe(url),
          autor,
          created_at: cuando,
          mensaje_id: String(m.id),
        });
      }
    }

    return NextResponse.json(
      successResponse({
        imagenes,
        audios,
        archivos,
        enlaces,
        // Avisa que hay historial más viejo del que se miró, para no dar por
        // completo lo que es apenas el tramo reciente.
        truncado: filas.length === MAX_MENSAJES,
      })
    );
  } catch (e) {
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "No se pudieron cargar los archivos"),
      { status: 500 }
    );
  }
}
