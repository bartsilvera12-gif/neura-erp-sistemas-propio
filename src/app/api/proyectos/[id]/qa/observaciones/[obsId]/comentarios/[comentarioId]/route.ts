import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { bumpProyectoActividad, registrarEventoQA } from "@/lib/proyectos/qa-shared";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; obsId: string; comentarioId: string }> }
) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

  const { id, obsId, comentarioId } = await params;
  const pid = id?.trim() ?? "";
  const oid = obsId?.trim() ?? "";
  const cid = comentarioId?.trim() ?? "";
  if (!pid || !oid || !cid) {
    return NextResponse.json(errorResponse("ids obligatorios"), { status: 400 });
  }

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    const { data: comentario, error: errC } = await sb
      .from("proyecto_qa_observacion_comentarios")
      .select("id, autor_id")
      .eq("empresa_id", auth.empresaId)
      .eq("proyecto_id", pid)
      .eq("observacion_id", oid)
      .eq("id", cid)
      .maybeSingle();
    if (errC) return NextResponse.json(errorResponse(errC.message), { status: 400 });
    if (!comentario) return NextResponse.json(errorResponse("No encontrado"), { status: 404 });

    // Mismo criterio que los adjuntos: cada quien borra lo suyo.
    const autorId = (comentario as { autor_id: string | null }).autor_id;
    if (autorId && autorId !== auth.usuarioCatalogId) {
      return NextResponse.json(
        errorResponse("Solo el autor puede eliminar su comentario"),
        { status: 403 }
      );
    }

    const { error } = await sb
      .from("proyecto_qa_observacion_comentarios")
      .delete()
      .eq("empresa_id", auth.empresaId)
      .eq("proyecto_id", pid)
      .eq("id", cid);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    await registrarEventoQA(sb, {
      empresaId: auth.empresaId,
      proyectoId: pid,
      usuarioId: auth.usuarioCatalogId,
      accion: "observacion_comentada",
      observacionId: oid,
      payload: { id: cid, eliminado: true },
    });
    await bumpProyectoActividad(sb, auth.empresaId, pid, auth.usuarioCatalogId);

    return NextResponse.json(successResponse({ id: cid }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
