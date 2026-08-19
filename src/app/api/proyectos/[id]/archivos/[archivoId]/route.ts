import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import {
  PROYECTOS_BUCKET,
  PROYECTOS_SIGNED_URL_TTL,
} from "@/lib/proyectos/proyectos-archivos-storage";

type ArchivoRow = {
  storage_bucket: string | null;
  storage_path: string;
  nombre: string;
  mime_type: string | null;
  uploaded_by: string | null;
};

async function fetchArchivo(
  sb: Awaited<ReturnType<typeof getChatServiceClientForEmpresa>>,
  empresaId: string,
  proyectoId: string,
  archivoId: string
): Promise<ArchivoRow | null> {
  const { data, error } = await sb
    .from("proyecto_archivos")
    .select("storage_bucket, storage_path, nombre, mime_type, uploaded_by")
    .eq("empresa_id", empresaId)
    .eq("proyecto_id", proyectoId)
    .eq("id", archivoId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ArchivoRow | null) ?? null;
}

/**
 * Alternar el marcador "confirmación de solicitud del cliente".
 *
 * Sin restricción de propietario a propósito: quien cargó el archivo puede no
 * ser quien se da cuenta de que es una confirmación del cliente (a diferencia
 * de eliminar, que sí es exclusivo de quien subió).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; archivoId: string }> }
) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  const { id, archivoId } = await params;
  const pid = id?.trim() ?? "";
  const aid = archivoId?.trim() ?? "";
  if (!pid || !aid) return NextResponse.json(errorResponse("ids obligatorios"), { status: 400 });

  try {
    const body = (await request.json().catch(() => null)) as { confirmacion_cliente?: unknown } | null;
    if (typeof body?.confirmacion_cliente !== "boolean") {
      return NextResponse.json(errorResponse("`confirmacion_cliente` debe ser booleano"), { status: 400 });
    }

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const archivo = await fetchArchivo(sb, auth.empresaId, pid, aid);
    if (!archivo) return NextResponse.json(errorResponse("No encontrado"), { status: 404 });

    if (body.confirmacion_cliente && !(archivo.mime_type ?? "").startsWith("image/")) {
      return NextResponse.json(
        errorResponse("Sólo las imágenes se pueden marcar como confirmación del cliente"),
        { status: 400 }
      );
    }

    const { error } = await sb
      .from("proyecto_archivos")
      .update({ confirmacion_cliente: body.confirmacion_cliente })
      .eq("empresa_id", auth.empresaId)
      .eq("proyecto_id", pid)
      .eq("id", aid);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    return NextResponse.json(successResponse({ id: aid, confirmacion_cliente: body.confirmacion_cliente }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/** Devuelve un signed URL de corta duración para vista previa (inline) o descarga (attachment). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; archivoId: string }> }
) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  const { id, archivoId } = await params;
  const pid = id?.trim() ?? "";
  const aid = archivoId?.trim() ?? "";
  if (!pid || !aid) return NextResponse.json(errorResponse("ids obligatorios"), { status: 400 });

  const download = new URL(request.url).searchParams.get("download") === "1";

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const archivo = await fetchArchivo(sb, auth.empresaId, pid, aid);
    if (!archivo) return NextResponse.json(errorResponse("No encontrado"), { status: 404 });

    const bucket = archivo.storage_bucket || PROYECTOS_BUCKET;
    const { data, error } = await sb.storage
      .from(bucket)
      .createSignedUrl(
        archivo.storage_path,
        PROYECTOS_SIGNED_URL_TTL,
        download ? { download: archivo.nombre } : undefined
      );

    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    if (!data?.signedUrl) {
      return NextResponse.json(errorResponse("No se pudo generar el enlace"), { status: 400 });
    }

    return NextResponse.json(successResponse({ url: data.signedUrl, nombre: archivo.nombre }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; archivoId: string }> }
) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  const { id, archivoId } = await params;
  const pid = id?.trim() ?? "";
  const aid = archivoId?.trim() ?? "";
  if (!pid || !aid) return NextResponse.json(errorResponse("ids obligatorios"), { status: 400 });

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const archivo = await fetchArchivo(sb, auth.empresaId, pid, aid);
    if (!archivo) return NextResponse.json(errorResponse("No encontrado"), { status: 404 });

    // Solo quien subió el archivo puede eliminarlo (consistente con tareas y comentarios).
    if (archivo.uploaded_by && archivo.uploaded_by !== auth.usuarioCatalogId) {
      return NextResponse.json(
        errorResponse("Solo quien subió el archivo puede eliminarlo"),
        { status: 403 }
      );
    }

    const { error } = await sb
      .from("proyecto_archivos")
      .delete()
      .eq("empresa_id", auth.empresaId)
      .eq("proyecto_id", pid)
      .eq("id", aid);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    const bucket = archivo.storage_bucket || PROYECTOS_BUCKET;
    await sb.storage.from(bucket).remove([archivo.storage_path]).catch(() => {});

    await sb
      .from("proyectos")
      .update({ last_activity_at: new Date().toISOString(), updated_by: auth.usuarioCatalogId })
      .eq("empresa_id", auth.empresaId)
      .eq("id", pid);

    return NextResponse.json(successResponse({ id: aid }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
