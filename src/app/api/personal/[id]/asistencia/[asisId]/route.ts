import { requirePersonalApi, ok, falla, errorInesperado } from "@/lib/personal/servidor";
import { esEstadoAsistencia } from "@/lib/personal/types";

const UUID = /^[0-9a-f-]{36}$/i;
type Params = { params: Promise<{ id: string; asisId: string }> };

/** PATCH /api/personal/:id/asistencia/:asisId — corrige una marca. */
export async function PATCH(request: Request, { params }: Params) {
  const auth = await requirePersonalApi(request);
  if (!auth.ok) return auth.respuesta;
  const { empresaId, sb } = auth.ctx;
  try {
    const { id, asisId } = await params;
    if (!UUID.test(id) || !UUID.test(asisId)) return falla("Registro inválido");
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return falla("Datos inválidos");

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if ("estado" in body) {
      if (!esEstadoAsistencia(body.estado)) return falla("Estado inválido");
      patch.estado = body.estado;
      if (body.estado !== "tarde") patch.minutos_tarde = 0;
    }
    const hhmm = (v: unknown) => (typeof v === "string" && /^\d{2}:\d{2}$/.test(v) ? v : null);
    if ("hora_entrada" in body) patch.hora_entrada = hhmm(body.hora_entrada);
    if ("hora_salida" in body) patch.hora_salida = hhmm(body.hora_salida);
    if ("minutos_tarde" in body && patch.estado !== undefined) {
      patch.minutos_tarde = patch.estado === "tarde" && Number.isFinite(Number(body.minutos_tarde)) ? Math.max(0, Math.round(Number(body.minutos_tarde))) : 0;
    } else if ("minutos_tarde" in body) {
      patch.minutos_tarde = Number.isFinite(Number(body.minutos_tarde)) ? Math.max(0, Math.round(Number(body.minutos_tarde))) : 0;
    }
    if ("observacion" in body) patch.observacion = typeof body.observacion === "string" ? body.observacion.trim().slice(0, 2000) || null : null;
    if (Object.keys(patch).length <= 1) return falla("Nada para actualizar");

    const { error } = await sb.from("personal_asistencia").update(patch).eq("empresa_id", empresaId).eq("usuario_id", id).eq("id", asisId);
    if (error) return falla(error.message);
    return ok({ actualizado: true });
  } catch (e) {
    return errorInesperado(e);
  }
}

/** DELETE /api/personal/:id/asistencia/:asisId */
export async function DELETE(request: Request, { params }: Params) {
  const auth = await requirePersonalApi(request);
  if (!auth.ok) return auth.respuesta;
  const { empresaId, sb } = auth.ctx;
  try {
    const { id, asisId } = await params;
    if (!UUID.test(id) || !UUID.test(asisId)) return falla("Registro inválido");
    const { error } = await sb.from("personal_asistencia").delete().eq("empresa_id", empresaId).eq("usuario_id", id).eq("id", asisId);
    if (error) return falla(error.message);
    return ok({ eliminado: true });
  } catch (e) {
    return errorInesperado(e);
  }
}
