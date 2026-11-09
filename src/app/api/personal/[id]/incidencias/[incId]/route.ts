import { requirePersonalApi, ok, falla, errorInesperado } from "@/lib/personal/servidor";
import { esEstadoIncidencia } from "@/lib/personal/types";

const UUID = /^[0-9a-f-]{36}$/i;
type Params = { params: Promise<{ id: string; incId: string }> };

/** PATCH /api/personal/:id/incidencias/:incId — cambia el estado o la descripción. */
export async function PATCH(request: Request, { params }: Params) {
  const auth = await requirePersonalApi(request);
  if (!auth.ok) return auth.respuesta;
  const { empresaId, sb } = auth.ctx;
  try {
    const { id, incId } = await params;
    if (!UUID.test(id) || !UUID.test(incId)) return falla("Parámetros inválidos");
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return falla("Datos inválidos");
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if ("estado" in body) {
      if (!esEstadoIncidencia(body.estado)) return falla("Estado inválido");
      patch.estado = body.estado;
    }
    if ("descripcion" in body) {
      const d = typeof body.descripcion === "string" ? body.descripcion.trim().slice(0, 5000) : "";
      if (!d) return falla("La descripción no puede quedar vacía");
      patch.descripcion = d;
    }
    if (Object.keys(patch).length <= 1) return falla("Nada para actualizar");

    const { error, count } = await sb
      .from("personal_incidencias")
      .update(patch, { count: "exact" })
      .eq("empresa_id", empresaId)
      .eq("usuario_id", id)
      .eq("id", incId);
    if (error) return falla(error.message);
    if (!count) return falla("Incidencia no encontrada", 404);
    return ok({ actualizado: true });
  } catch (e) {
    return errorInesperado(e);
  }
}

/** DELETE /api/personal/:id/incidencias/:incId */
export async function DELETE(request: Request, { params }: Params) {
  const auth = await requirePersonalApi(request);
  if (!auth.ok) return auth.respuesta;
  const { empresaId, sb } = auth.ctx;
  try {
    const { id, incId } = await params;
    if (!UUID.test(id) || !UUID.test(incId)) return falla("Parámetros inválidos");
    const { error } = await sb
      .from("personal_incidencias")
      .delete()
      .eq("empresa_id", empresaId)
      .eq("usuario_id", id)
      .eq("id", incId);
    if (error) return falla(error.message);
    return ok({ eliminado: true });
  } catch (e) {
    return errorInesperado(e);
  }
}
