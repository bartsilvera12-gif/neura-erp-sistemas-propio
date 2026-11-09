import { requirePersonalApi, ok, falla, errorInesperado, componerKpis, resumenAsistencia, nombresPorId } from "@/lib/personal/servidor";
import type { FichaFuncionario, TipoIncidencia } from "@/lib/personal/types";

const UUID = /^[0-9a-f-]{36}$/i;
type Params = { params: Promise<{ id: string }> };

/** GET /api/personal/:id — ficha del funcionario con KPIs y datos de cargo. */
export async function GET(request: Request, { params }: Params) {
  const auth = await requirePersonalApi(request);
  if (!auth.ok) return auth.respuesta;
  const { empresaId, sb } = auth.ctx;
  try {
    const { id } = await params;
    if (!UUID.test(id)) return falla("Funcionario inválido");

    const { data: u, error } = await sb
      .from("usuarios")
      .select("id, nombre, email, telefono, codigo_empleado, cargo, area, modalidad, estado, rol, fecha_ingreso, fecha_nacimiento, tipo_contrato, dias_vacaciones_anuales, avatar_path, supervisor_id")
      .eq("empresa_id", empresaId)
      .eq("id", id)
      .maybeSingle();
    if (error) return falla(error.message);
    if (!u) return falla("Funcionario no encontrado", 404);
    const row = u as Record<string, unknown>;

    const supervisorId = (row.supervisor_id as string | null) ?? null;
    const nombres = await nombresPorId(sb, empresaId, [supervisorId]);

    const desde = new Date();
    desde.setMonth(desde.getMonth() - 12);
    const { data: inc } = await sb
      .from("personal_incidencias")
      .select("tipo")
      .eq("empresa_id", empresaId)
      .eq("usuario_id", id)
      .neq("estado", "anulada")
      .gte("fecha", desde.toISOString().slice(0, 10));
    const tipos = ((inc ?? []) as { tipo: TipoIncidencia }[]).map((r) => r.tipo);

    // Asistencia de los últimos 90 días para el KPI de % y las tardes reales.
    const desdeAsis = new Date();
    desdeAsis.setDate(desdeAsis.getDate() - 90);
    const asis = await resumenAsistencia(sb, empresaId, id, desdeAsis.toISOString().slice(0, 10));

    const ficha: FichaFuncionario = {
      id: String(row.id),
      nombre: (row.nombre as string | null) ?? "—",
      email: (row.email as string | null) ?? null,
      telefono: (row.telefono as string | null) ?? null,
      codigo_empleado: (row.codigo_empleado as string | null) ?? null,
      cargo: (row.cargo as string | null) ?? null,
      area: (row.area as string | null) ?? null,
      modalidad: (row.modalidad as string | null) ?? null,
      estado: (row.estado as string | null) ?? null,
      rol: (row.rol as string | null) ?? null,
      fecha_ingreso: (row.fecha_ingreso as string | null) ?? null,
      fecha_nacimiento: (row.fecha_nacimiento as string | null) ?? null,
      tipo_contrato: (row.tipo_contrato as string | null) ?? null,
      dias_vacaciones_anuales: (row.dias_vacaciones_anuales as number | null) ?? null,
      avatar_path: (row.avatar_path as string | null) ?? null,
      supervisor: supervisorId ? { id: supervisorId, nombre: nombres.get(supervisorId) ?? "—" } : null,
      kpis: componerKpis(tipos, asis),
    };
    return ok({ ficha });
  } catch (e) {
    return errorInesperado(e);
  }
}

/** PATCH /api/personal/:id — datos de cargo editables desde RRHH. */
export async function PATCH(request: Request, { params }: Params) {
  const auth = await requirePersonalApi(request);
  if (!auth.ok) return auth.respuesta;
  const { empresaId, sb } = auth.ctx;
  try {
    const { id } = await params;
    if (!UUID.test(id)) return falla("Funcionario inválido");
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return falla("Datos inválidos");

    const texto = (v: unknown, max = 200): string | null => {
      if (v == null) return null;
      const s = String(v).trim();
      return s ? s.slice(0, max) : null;
    };
    const patch: Record<string, unknown> = {};
    if ("codigo_empleado" in body) patch.codigo_empleado = texto(body.codigo_empleado, 40);
    if ("cargo" in body) patch.cargo = texto(body.cargo, 120);
    if ("modalidad" in body) patch.modalidad = texto(body.modalidad, 60);
    if ("area" in body) patch.area = texto(body.area, 120);
    if ("dias_vacaciones_anuales" in body) {
      const n = Number(body.dias_vacaciones_anuales);
      patch.dias_vacaciones_anuales = Number.isFinite(n) && n >= 0 ? Math.min(60, Math.round(n)) : null;
    }
    if ("supervisor_id" in body) {
      const sup = typeof body.supervisor_id === "string" && UUID.test(body.supervisor_id) ? body.supervisor_id : null;
      if (sup) {
        if (sup === id) return falla("Un funcionario no puede ser su propio supervisor");
        const { data: existe } = await sb.from("usuarios").select("id").eq("empresa_id", empresaId).eq("id", sup).maybeSingle();
        if (!existe) return falla("El supervisor no existe en la empresa", 404);
      }
      patch.supervisor_id = sup;
    }
    if (!Object.keys(patch).length) return falla("Nada para actualizar");

    const { error } = await sb.from("usuarios").update(patch).eq("empresa_id", empresaId).eq("id", id);
    if (error) return falla(error.message);
    return ok({ actualizado: true });
  } catch (e) {
    return errorInesperado(e);
  }
}
