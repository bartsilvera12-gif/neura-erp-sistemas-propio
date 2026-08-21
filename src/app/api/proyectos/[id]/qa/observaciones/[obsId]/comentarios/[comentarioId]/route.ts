import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import {
  QA_OBSERVACION_COMENTARIO_SELECT,
  bumpProyectoActividad,
  nombresUsuarios,
  registrarEventoQA,
  type QAObservacionComentarioRow,
} from "@/lib/proyectos/qa-shared";

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

/**
 * Editar un comentario ya publicado.
 *
 * Mismo criterio de autoría que el borrado: cada quien edita lo suyo. No se
 * permite cambiar el `origen` — mover un mensaje de la conversación técnica al
 * hilo interno (o al revés) cambiaría quién puede leerlo después de que ya se
 * mostró, que es justo lo que no debe pasar.
 */
export async function PATCH(
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
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const texto = typeof body?.texto === "string" ? body.texto.trim().slice(0, 5000) : "";
    if (!texto) return NextResponse.json(errorResponse("texto obligatorio"), { status: 400 });

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

    const autorId = (comentario as { autor_id: string | null }).autor_id;
    if (autorId && autorId !== auth.usuarioCatalogId) {
      return NextResponse.json(
        errorResponse("Solo el autor puede editar su comentario"),
        { status: 403 }
      );
    }

    const ahora = new Date().toISOString();
    const { data, error } = await sb
      .from("proyecto_qa_observacion_comentarios")
      .update({ texto, updated_at: ahora })
      .eq("empresa_id", auth.empresaId)
      .eq("proyecto_id", pid)
      .eq("id", cid)
      .select(QA_OBSERVACION_COMENTARIO_SELECT);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    const row = (Array.isArray(data) ? data[0] : data) as QAObservacionComentarioRow;
    const nombres = await nombresUsuarios(auth.empresaId, [row.autor_id]);

    await registrarEventoQA(sb, {
      empresaId: auth.empresaId,
      proyectoId: pid,
      usuarioId: auth.usuarioCatalogId,
      accion: "observacion_comentada",
      observacionId: oid,
      payload: { id: cid, editado: true },
    });

    return NextResponse.json(
      successResponse({
        ...row,
        autor_nombre: row.autor_id ? nombres.get(row.autor_id) || null : null,
      })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
