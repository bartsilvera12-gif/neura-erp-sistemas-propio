import { requirePersonalApi, ok, falla, errorInesperado, nombresPorId } from "@/lib/personal/servidor";
import { esEstadoVacacion } from "@/lib/personal/types";

const UUID = /^[0-9a-f-]{36}$/i;
type Params = { params: Promise<{ id: string; vacId: string }> };

/** PATCH /api/personal/:id/vacaciones/:vacId — aprobar/rechazar/anular o marcar gozada. */
export async function PATCH(request: Request, { params }: Params) {
  const auth = await requirePersonalApi(request);
  if (!auth.ok) return auth.respuesta;
  const { empresaId, usuarioId, sb } = auth.ctx;
  try {
    const { id, vacId } = await params;
    if (!UUID.test(id) || !UUID.test(vacId)) return falla("Registro inválido");
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return falla("Datos inválidos");

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if ("estado" in body) {
      if (!esEstadoVacacion(body.estado)) return falla("Estado inválido");
      patch.estado = body.estado;
      if (body.estado === "aprobada" || body.estado === "rechazada") {
        const label = usuarioId ? (await nombresPorId(sb, empresaId, [usuarioId])).get(usuarioId) ?? null : null;
        patch.aprobado_por_id = usuarioId;
        patch.aprobado_por_label = label;
        patch.aprobado_at = new Date().toISOString();
      }
    }
    if ("motivo" in body) patch.motivo = typeof body.motivo === "string" ? body.motivo.trim().slice(0, 2000) || null : null;
    if (Object.keys(patch).length <= 1) return falla("Nada para actualizar");

    const { error } = await sb.from("personal_vacaciones").update(patch).eq("empresa_id", empresaId).eq("usuario_id", id).eq("id", vacId);
    if (error) return falla(error.message);
    return ok({ actualizado: true });
  } catch (e) {
    return errorInesperado(e);
  }
}

/** DELETE /api/personal/:id/vacaciones/:vacId */
export async function DELETE(request: Request, { params }: Params) {
  const auth = await requirePersonalApi(request);
  if (!auth.ok) return auth.respuesta;
  const { empresaId, sb } = auth.ctx;
  try {
    const { id, vacId } = await params;
    if (!UUID.test(id) || !UUID.test(vacId)) return falla("Registro inválido");
    const { error } = await sb.from("personal_vacaciones").delete().eq("empresa_id", empresaId).eq("usuario_id", id).eq("id", vacId);
    if (error) return falla(error.message);
    return ok({ eliminado: true });
  } catch (e) {
    return errorInesperado(e);
  }
}
