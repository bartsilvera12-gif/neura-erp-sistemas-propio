import { NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api/response";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { requireAyudaAdminAccess } from "@/lib/ayuda/ayuda-auth";
import {
  AYUDA_ADJUNTO_MAX_BYTES,
  AYUDA_BUCKET,
  buildAyudaAdjuntoPath,
  ensureAyudaBucket,
} from "@/lib/ayuda/ayuda-adjuntos-storage";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const ADJUNTO_SELECT = "id, nombre, mime_type, size_bytes, orden, created_at";

/** Lista los adjuntos de un artículo (para el editor). */
export async function GET(request: Request, context: RouteContext) {
  try {
    const auth = await requireAyudaAdminAccess(request);
    if (!auth.ok) {
      return NextResponse.json(errorResponse(auth.message), { status: auth.status });
    }
    const { id } = await context.params;
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const { data, error } = await sb
      .from("ayuda_articulo_adjuntos")
      .select(ADJUNTO_SELECT)
      .eq("empresa_id", auth.empresaId)
      .eq("articulo_id", id)
      .order("orden", { ascending: true });
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    return NextResponse.json(successResponse({ adjuntos: data ?? [] }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "No se pudieron cargar los adjuntos";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/** Sube un documento y lo asocia al artículo. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireAyudaAdminAccess(request);
    if (!auth.ok) {
      return NextResponse.json(errorResponse(auth.message), { status: auth.status });
    }
    const { id } = await context.params;

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(errorResponse("Archivo requerido"), { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json(errorResponse("El archivo está vacío"), { status: 400 });
    }
    if (file.size > AYUDA_ADJUNTO_MAX_BYTES) {
      return NextResponse.json(
        errorResponse(`El archivo supera el máximo de ${Math.round(AYUDA_ADJUNTO_MAX_BYTES / (1024 * 1024))} MB`),
        { status: 400 }
      );
    }

    const nombre = (file.name || "documento").trim().slice(0, 200) || "documento";
    const mimeType = file.type || "application/octet-stream";

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    // El artículo debe existir y ser de la empresa antes de subir nada.
    const { data: articulo, error: eArt } = await sb
      .from("ayuda_articulos")
      .select("id")
      .eq("empresa_id", auth.empresaId)
      .eq("id", id)
      .maybeSingle();
    if (eArt) return NextResponse.json(errorResponse(eArt.message), { status: 400 });
    if (!articulo) return NextResponse.json(errorResponse("Artículo no encontrado"), { status: 404 });

    await ensureAyudaBucket(sb);

    const storagePath = buildAyudaAdjuntoPath(auth.empresaId, id, nombre);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const up = await sb.storage.from(AYUDA_BUCKET).upload(storagePath, bytes, {
      contentType: mimeType,
      upsert: false,
    });
    if (up.error) {
      return NextResponse.json(errorResponse(up.error.message), { status: 400 });
    }

    const { data: inserted, error: eInsert } = await sb
      .from("ayuda_articulo_adjuntos")
      .insert({
        empresa_id: auth.empresaId,
        articulo_id: id,
        nombre,
        storage_bucket: AYUDA_BUCKET,
        storage_path: storagePath,
        mime_type: mimeType,
        size_bytes: file.size,
        subido_por: auth.usuarioCatalogId,
      })
      .select(ADJUNTO_SELECT);

    if (eInsert) {
      // El registro falló: no dejamos el objeto huérfano en el storage.
      await sb.storage.from(AYUDA_BUCKET).remove([storagePath]).catch(() => {});
      return NextResponse.json(errorResponse(eInsert.message), { status: 400 });
    }

    const row = Array.isArray(inserted) ? inserted[0] : inserted;
    return NextResponse.json(successResponse({ adjunto: row }), { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "No se pudo subir el documento";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
