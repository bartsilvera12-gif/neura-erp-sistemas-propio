import { requirePersonalApi, ok, falla, errorInesperado } from "@/lib/personal/servidor";

const UUID = /^[0-9a-f-]{36}$/i;
type Params = { params: Promise<{ id: string; evalId: string }> };

/** PATCH /api/personal/:id/desempeno/:evalId — por ahora, finalizar un borrador. */
export async function PATCH(request: Request, { params }: Params) {
  const auth = await requirePersonalApi(request);
  if (!auth.ok) return auth.respuesta;
  const { empresaId, sb } = auth.ctx;
  try {
    const { id, evalId } = await params;
    if (!UUID.test(id) || !UUID.test(evalId)) return falla("Registro inválido");
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return falla("Datos inválidos");
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if ("estado" in body) {
      if (body.estado !== "borrador" && body.estado !== "finalizada") return falla("Estado inválido");
      patch.estado = body.estado;
    }
    const texto = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 4000) || null : null);
    if ("comentario" in body) patch.comentario = texto(body.comentario);
    if ("fortalezas" in body) patch.fortalezas = texto(body.fortalezas);
    if ("mejoras" in body) patch.mejoras = texto(body.mejoras);
    if (Object.keys(patch).length <= 1) return falla("Nada para actualizar");

    const { error } = await sb.from("personal_evaluaciones").update(patch).eq("empresa_id", empresaId).eq("usuario_id", id).eq("id", evalId);
    if (error) return falla(error.message);
    return ok({ actualizado: true });
  } catch (e) {
    return errorInesperado(e);
  }
}

/** DELETE /api/personal/:id/desempeno/:evalId */
export async function DELETE(request: Request, { params }: Params) {
  const auth = await requirePersonalApi(request);
  if (!auth.ok) return auth.respuesta;
  const { empresaId, sb } = auth.ctx;
  try {
    const { id, evalId } = await params;
    if (!UUID.test(id) || !UUID.test(evalId)) return falla("Registro inválido");
    const { error } = await sb.from("personal_evaluaciones").delete().eq("empresa_id", empresaId).eq("usuario_id", id).eq("id", evalId);
    if (error) return falla(error.message);
    return ok({ eliminado: true });
  } catch (e) {
    return errorInesperado(e);
  }
}
