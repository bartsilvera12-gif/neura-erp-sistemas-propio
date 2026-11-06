import { requireSoporteApi, type SoporteContexto } from "@/lib/soporte/soporte-auth";
import {
  errorInesperado,
  falla,
  ok,
  sinPermiso,
  ticketDeEmpresa,
  tocarTicket,
} from "@/lib/soporte/servidor";

type Params = { params: Promise<{ id: string; comentarioId: string }> };

/** Lee el comentario del ticket/empresa y devuelve su autor (o null si no existe). */
async function autorDelComentario(
  auth: SoporteContexto,
  ticketId: string,
  comentarioId: string
): Promise<{ usuario_id: string | null; es_rechazo_qa: boolean } | null> {
  const { data } = await auth.sb
    .from("soporte_ticket_comentarios")
    .select("id, usuario_id, es_rechazo_qa")
    .eq("empresa_id", auth.empresaId)
    .eq("ticket_id", ticketId)
    .eq("id", comentarioId)
    .is("subtarea_id", null)
    .maybeSingle();
  return (data as { usuario_id: string | null; es_rechazo_qa: boolean } | null) ?? null;
}

/**
 * PATCH — editar un comentario. Solo el autor puede editar el suyo. Deja la
 * marca `editado_at` para que la UI muestre "editado".
 */
export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  try {
    const { id, comentarioId } = await params;
    if (!(await ticketDeEmpresa(auth.sb, auth.empresaId, id, "id"))) return falla("Ticket no encontrado", 404);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const contenido = typeof body?.contenido === "string" ? body.contenido.trim().slice(0, 20_000) : "";
    if (!contenido) return falla("Escribí el comentario");

    const com = await autorDelComentario(auth, id, comentarioId);
    if (!com) return falla("Comentario no encontrado", 404);
    if (com.es_rechazo_qa) return falla("Las devoluciones de QA no se pueden editar", 403);
    if (com.usuario_id !== auth.usuarioId) return falla("Solo podés editar tus propios comentarios", 403);

    const { error } = await auth.sb
      .from("soporte_ticket_comentarios")
      .update({ contenido, editado_at: new Date().toISOString() })
      .eq("empresa_id", auth.empresaId)
      .eq("id", comentarioId);
    if (error) return falla(error.message);

    await tocarTicket(auth.sb, auth.empresaId, id, auth.usuarioId);
    return ok({ id: comentarioId });
  } catch (e) {
    return errorInesperado(e);
  }
}

/**
 * DELETE — eliminar un comentario. Solo el autor puede eliminar el suyo. Los
 * adjuntos se despegan solos (FK ON DELETE SET NULL): siguen en el ticket.
 */
export async function DELETE(request: Request, { params }: Params) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  try {
    const { id, comentarioId } = await params;
    if (!(await ticketDeEmpresa(auth.sb, auth.empresaId, id, "id"))) return falla("Ticket no encontrado", 404);

    const com = await autorDelComentario(auth, id, comentarioId);
    if (!com) return falla("Comentario no encontrado", 404);
    if (com.es_rechazo_qa) return falla("Las devoluciones de QA no se pueden eliminar", 403);
    if (com.usuario_id !== auth.usuarioId) return falla("Solo podés eliminar tus propios comentarios", 403);

    const { error } = await auth.sb
      .from("soporte_ticket_comentarios")
      .delete()
      .eq("empresa_id", auth.empresaId)
      .eq("id", comentarioId);
    if (error) return falla(error.message);

    await tocarTicket(auth.sb, auth.empresaId, id, auth.usuarioId);
    return ok({ id: comentarioId });
  } catch (e) {
    return errorInesperado(e);
  }
}
