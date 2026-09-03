import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import {
  PROYECTOS_ARCHIVO_MAX_BYTES,
  PROYECTOS_BUCKET,
  PROYECTOS_SIGNED_URL_TTL,
  buildComentarioAdjuntoPath,
  comentarioAdjuntoPrefix,
  ensureProyectosBucket,
} from "@/lib/proyectos/proyectos-archivos-storage";

/**
 * Adjuntos (imágenes) de comentarios.
 *
 * POST: sube UNA imagen al bucket privado y devuelve su metadata
 *   ({ path, nombre, mime_type, size_bytes }) SIN crear fila: la referencia la
 *   guarda el propio comentario en su columna `adjuntos` al publicarse.
 * GET (?path=…&download=0|1): devuelve un signed URL de corta duración para ver
 *   o descargar una imagen ya adjuntada. Valida que el path pertenezca a este
 *   proyecto, así nadie puede firmar archivos de otro.
 */

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  const { id } = await params;
  const pid = id?.trim() ?? "";
  if (!pid) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

  try {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(errorResponse("Imagen requerida"), { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json(errorResponse("La imagen está vacía"), { status: 400 });
    }
    if (file.size > PROYECTOS_ARCHIVO_MAX_BYTES) {
      return NextResponse.json(
        errorResponse(`La imagen supera el máximo de ${Math.round(PROYECTOS_ARCHIVO_MAX_BYTES / (1024 * 1024))} MB`),
        { status: 400 }
      );
    }
    const mimeType = file.type || "application/octet-stream";
    if (!mimeType.startsWith("image/")) {
      return NextResponse.json(errorResponse("Solo se pueden adjuntar imágenes"), { status: 400 });
    }
    const nombre = (file.name || "imagen").trim().slice(0, 200) || "imagen";

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    const { data: proyecto, error: eProyecto } = await sb
      .from("proyectos")
      .select("id")
      .eq("empresa_id", auth.empresaId)
      .eq("id", pid)
      .maybeSingle();
    if (eProyecto) return NextResponse.json(errorResponse(eProyecto.message), { status: 400 });
    if (!proyecto) return NextResponse.json(errorResponse("Proyecto no encontrado"), { status: 404 });

    await ensureProyectosBucket(sb);

    const storagePath = buildComentarioAdjuntoPath(auth.empresaId, pid, nombre);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const up = await sb.storage.from(PROYECTOS_BUCKET).upload(storagePath, bytes, {
      contentType: mimeType,
      upsert: false,
    });
    if (up.error) return NextResponse.json(errorResponse(up.error.message), { status: 400 });

    return NextResponse.json(
      successResponse({ path: storagePath, nombre, mime_type: mimeType, size_bytes: file.size })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  const { id } = await params;
  const pid = id?.trim() ?? "";
  if (!pid) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

  const url = new URL(request.url);
  const path = url.searchParams.get("path") ?? "";
  const download = url.searchParams.get("download") === "1";
  // El path debe pertenecer a los comentarios de ESTE proyecto: nadie firma otro.
  if (!path || !path.startsWith(comentarioAdjuntoPrefix(auth.empresaId, pid))) {
    return NextResponse.json(errorResponse("path inválido"), { status: 400 });
  }
  const nombre = path.split("/").pop() || "imagen";

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const { data, error } = await sb.storage
      .from(PROYECTOS_BUCKET)
      .createSignedUrl(path, PROYECTOS_SIGNED_URL_TTL, download ? { download: nombre } : undefined);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    if (!data?.signedUrl) {
      return NextResponse.json(errorResponse("No se pudo generar el enlace"), { status: 400 });
    }
    return NextResponse.json(successResponse({ url: data.signedUrl }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
