import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import {
  PROYECTOS_ARCHIVO_MAX_BYTES,
  PROYECTOS_BUCKET,
  ensureProyectosBucket,
} from "@/lib/proyectos/proyectos-archivos-storage";
import {
  QA_OBSERVACION_ARCHIVO_SELECT,
  QA_OBSERVACION_SIGNED_URL_TTL,
  aArchivoPublico,
  bumpProyectoActividad,
  buildQAObservacionArchivoPath,
  fetchObservacion,
  registrarEventoQA,
  siguienteSortOrder,
  type QAObservacionArchivoRow,
} from "@/lib/proyectos/qa-shared";

/** La galería de QA es de capturas: sólo imágenes y PDFs. */
function mimeAceptado(mime: string): boolean {
  const m = mime.toLowerCase();
  return m.startsWith("image/") || m === "application/pdf";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; obsId: string }> }
) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

  const { id, obsId } = await params;
  const pid = id?.trim() ?? "";
  const oid = obsId?.trim() ?? "";
  if (!pid || !oid) return NextResponse.json(errorResponse("ids obligatorios"), { status: 400 });

  try {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(errorResponse("Archivo requerido"), { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json(errorResponse("El archivo está vacío"), { status: 400 });
    }
    if (file.size > PROYECTOS_ARCHIVO_MAX_BYTES) {
      return NextResponse.json(
        errorResponse(
          `El archivo supera el máximo de ${Math.round(PROYECTOS_ARCHIVO_MAX_BYTES / (1024 * 1024))} MB`
        ),
        { status: 400 }
      );
    }

    const mimeType = file.type || "application/octet-stream";
    if (!mimeAceptado(mimeType)) {
      return NextResponse.json(errorResponse("Solo se aceptan imágenes o PDF"), { status: 400 });
    }
    const nombre = (file.name || "captura").trim().slice(0, 200) || "captura";

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const observacion = await fetchObservacion(sb, auth.empresaId, pid, oid);
    if (!observacion) {
      return NextResponse.json(errorResponse("Observación no encontrada"), { status: 404 });
    }

    await ensureProyectosBucket(sb);

    const sort_order = await siguienteSortOrder(
      sb,
      "proyecto_qa_observacion_archivos",
      auth.empresaId,
      { observacion_id: oid }
    );

    const storagePath = buildQAObservacionArchivoPath(auth.empresaId, pid, oid, nombre);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const up = await sb.storage.from(PROYECTOS_BUCKET).upload(storagePath, bytes, {
      contentType: mimeType,
      upsert: false,
    });
    if (up.error) return NextResponse.json(errorResponse(up.error.message), { status: 400 });

    const { data, error } = await sb
      .from("proyecto_qa_observacion_archivos")
      .insert({
        empresa_id: auth.empresaId,
        proyecto_id: pid,
        observacion_id: oid,
        nombre,
        storage_bucket: PROYECTOS_BUCKET,
        storage_path: storagePath,
        mime_type: mimeType,
        size_bytes: file.size,
        sort_order,
        uploaded_by: auth.usuarioCatalogId,
      })
      .select(QA_OBSERVACION_ARCHIVO_SELECT);
    if (error) {
      // El objeto ya subió: sin fila que lo referencie hay que sacarlo.
      await sb.storage.from(PROYECTOS_BUCKET).remove([storagePath]).catch(() => {});
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }

    await registrarEventoQA(sb, {
      empresaId: auth.empresaId,
      proyectoId: pid,
      usuarioId: auth.usuarioCatalogId,
      accion: "observacion_archivo_subido",
      observacionId: oid,
      payload: { numero: observacion.numero, nombre, size: file.size },
    });
    await bumpProyectoActividad(sb, auth.empresaId, pid, auth.usuarioCatalogId);

    const row = (Array.isArray(data) ? data[0] : data) as QAObservacionArchivoRow;
    const { data: firmada } = await sb.storage
      .from(PROYECTOS_BUCKET)
      .createSignedUrl(storagePath, QA_OBSERVACION_SIGNED_URL_TTL);

    return NextResponse.json(successResponse(aArchivoPublico(row, firmada?.signedUrl ?? null)));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
