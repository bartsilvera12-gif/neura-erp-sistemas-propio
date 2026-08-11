import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { PROYECTOS_BUCKET } from "@/lib/proyectos/proyectos-archivos-storage";
import {
  QA_OBSERVACION_SIGNED_URL_TTL,
  bumpProyectoActividad,
  registrarEventoQA,
  type QASupabase,
} from "@/lib/proyectos/qa-shared";

type ArchivoRow = {
  storage_bucket: string | null;
  storage_path: string;
  nombre: string;
  uploaded_by: string | null;
  observacion_id: string;
};

async function fetchArchivo(
  sb: QASupabase,
  empresaId: string,
  proyectoId: string,
  observacionId: string,
  archivoId: string
): Promise<ArchivoRow | null> {
  const { data, error } = await sb
    .from("proyecto_qa_observacion_archivos")
    .select("storage_bucket, storage_path, nombre, uploaded_by, observacion_id")
    .eq("empresa_id", empresaId)
    .eq("proyecto_id", proyectoId)
    .eq("observacion_id", observacionId)
    .eq("id", archivoId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ArchivoRow | null) ?? null;
}

/** Refresca el enlace de un adjunto cuando venció el de la carga inicial. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; obsId: string; archivoId: string }> }
) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

  const { id, obsId, archivoId } = await params;
  const pid = id?.trim() ?? "";
  const oid = obsId?.trim() ?? "";
  const aid = archivoId?.trim() ?? "";
  if (!pid || !oid || !aid) {
    return NextResponse.json(errorResponse("ids obligatorios"), { status: 400 });
  }
  const download = new URL(request.url).searchParams.get("download") === "1";

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const archivo = await fetchArchivo(sb, auth.empresaId, pid, oid, aid);
    if (!archivo) return NextResponse.json(errorResponse("No encontrado"), { status: 404 });

    const bucket = archivo.storage_bucket || PROYECTOS_BUCKET;
    const { data, error } = await sb.storage
      .from(bucket)
      .createSignedUrl(
        archivo.storage_path,
        QA_OBSERVACION_SIGNED_URL_TTL,
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
  { params }: { params: Promise<{ id: string; obsId: string; archivoId: string }> }
) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

  const { id, obsId, archivoId } = await params;
  const pid = id?.trim() ?? "";
  const oid = obsId?.trim() ?? "";
  const aid = archivoId?.trim() ?? "";
  if (!pid || !oid || !aid) {
    return NextResponse.json(errorResponse("ids obligatorios"), { status: 400 });
  }

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const archivo = await fetchArchivo(sb, auth.empresaId, pid, oid, aid);
    if (!archivo) return NextResponse.json(errorResponse("No encontrado"), { status: 404 });

    if (archivo.uploaded_by && archivo.uploaded_by !== auth.usuarioCatalogId) {
      return NextResponse.json(
        errorResponse("Solo quien subió el archivo puede eliminarlo"),
        { status: 403 }
      );
    }

    const { error } = await sb
      .from("proyecto_qa_observacion_archivos")
      .delete()
      .eq("empresa_id", auth.empresaId)
      .eq("proyecto_id", pid)
      .eq("id", aid);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    const bucket = archivo.storage_bucket || PROYECTOS_BUCKET;
    await sb.storage.from(bucket).remove([archivo.storage_path]).catch(() => {});

    await registrarEventoQA(sb, {
      empresaId: auth.empresaId,
      proyectoId: pid,
      usuarioId: auth.usuarioCatalogId,
      accion: "observacion_archivo_eliminado",
      observacionId: oid,
      payload: { id: aid, nombre: archivo.nombre },
    });
    await bumpProyectoActividad(sb, auth.empresaId, pid, auth.usuarioCatalogId);

    return NextResponse.json(successResponse({ id: aid }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
