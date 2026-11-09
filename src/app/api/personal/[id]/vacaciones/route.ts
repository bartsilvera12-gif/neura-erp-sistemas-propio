import { requirePersonalApi, ok, falla, errorInesperado, nombresPorId } from "@/lib/personal/servidor";
import { esTipoVacacion, type SaldoVacaciones, type VacacionDTO } from "@/lib/personal/types";

const UUID = /^[0-9a-f-]{36}$/i;
const DIAS_VACACIONES_DEFAULT = 12; // Paraguay: 12 días hábiles (antigüedad < 5 años)
type Params = { params: Promise<{ id: string }> };

/** Días hábiles (lun–vie) entre dos fechas inclusive. */
function diasHabiles(ini: string, fin: string): number {
  const a = new Date(`${ini}T00:00:00`);
  const b = new Date(`${fin}T00:00:00`);
  if (isNaN(a.getTime()) || isNaN(b.getTime()) || b < a) return 0;
  let n = 0;
  for (const d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}

/** GET /api/personal/:id/vacaciones — solicitudes + saldo del año en curso. */
export async function GET(request: Request, { params }: Params) {
  const auth = await requirePersonalApi(request);
  if (!auth.ok) return auth.respuesta;
  const { empresaId, sb } = auth.ctx;
  try {
    const { id } = await params;
    if (!UUID.test(id)) return falla("Funcionario inválido");

    const { data: u } = await sb.from("usuarios").select("dias_vacaciones_anuales").eq("empresa_id", empresaId).eq("id", id).maybeSingle();
    const anuales = Number((u as { dias_vacaciones_anuales: number | null } | null)?.dias_vacaciones_anuales ?? DIAS_VACACIONES_DEFAULT);

    const { data, error } = await sb
      .from("personal_vacaciones")
      .select("id, tipo, fecha_inicio, fecha_fin, dias, motivo, estado, aprobado_por_id, aprobado_por_label, aprobado_at, created_at")
      .eq("empresa_id", empresaId)
      .eq("usuario_id", id)
      .order("fecha_inicio", { ascending: false });
    if (error) return falla(error.message);
    const filas = (data ?? []) as {
      id: string; tipo: VacacionDTO["tipo"]; fecha_inicio: string; fecha_fin: string; dias: number;
      motivo: string | null; estado: VacacionDTO["estado"]; aprobado_por_id: string | null;
      aprobado_por_label: string | null; aprobado_at: string | null; created_at: string;
    }[];

    const faltan = filas.filter((f) => !f.aprobado_por_label && f.aprobado_por_id).map((f) => f.aprobado_por_id);
    const nombres = faltan.length ? await nombresPorId(sb, empresaId, faltan) : new Map<string, string>();

    const vacaciones: VacacionDTO[] = filas.map((f) => ({
      id: f.id,
      tipo: f.tipo,
      fecha_inicio: f.fecha_inicio,
      fecha_fin: f.fecha_fin,
      dias: Number(f.dias),
      motivo: f.motivo,
      estado: f.estado,
      aprobado_por: f.aprobado_por_label ?? (f.aprobado_por_id ? nombres.get(f.aprobado_por_id) ?? null : null),
      aprobado_at: f.aprobado_at,
      created_at: f.created_at,
    }));

    const anio = new Date().getFullYear();
    let gozados = 0, aprobados = 0;
    for (const v of vacaciones) {
      if (v.tipo !== "vacaciones") continue;
      if (new Date(`${v.fecha_inicio}T00:00:00`).getFullYear() !== anio) continue;
      if (v.estado === "gozada") gozados += v.dias;
      else if (v.estado === "aprobada") aprobados += v.dias;
    }
    const saldo: SaldoVacaciones = { anio, anuales, gozados, aprobados, disponibles: Math.max(0, anuales - gozados - aprobados) };
    return ok({ vacaciones, saldo });
  } catch (e) {
    return errorInesperado(e);
  }
}

/** POST /api/personal/:id/vacaciones — nueva solicitud. */
export async function POST(request: Request, { params }: Params) {
  const auth = await requirePersonalApi(request);
  if (!auth.ok) return auth.respuesta;
  const { empresaId, usuarioId, sb } = auth.ctx;
  try {
    const { id } = await params;
    if (!UUID.test(id)) return falla("Funcionario inválido");
    const { data: empleado } = await sb.from("usuarios").select("id").eq("empresa_id", empresaId).eq("id", id).maybeSingle();
    if (!empleado) return falla("Funcionario no encontrado", 404);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return falla("Datos inválidos");
    const tipo = esTipoVacacion(body.tipo) ? body.tipo : "vacaciones";
    const fechaOk = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (!fechaOk(body.fecha_inicio) || !fechaOk(body.fecha_fin)) return falla("Elegí el rango de fechas");
    const ini = body.fecha_inicio as string;
    const fin = body.fecha_fin as string;
    if (fin < ini) return falla("La fecha de fin no puede ser anterior al inicio");
    let dias = Number(body.dias);
    if (!Number.isFinite(dias) || dias <= 0) dias = diasHabiles(ini, fin);
    if (dias <= 0) dias = 1;
    const motivo = typeof body.motivo === "string" ? body.motivo.trim().slice(0, 2000) || null : null;
    const label = usuarioId ? (await nombresPorId(sb, empresaId, [usuarioId])).get(usuarioId) ?? null : null;

    const { data, error } = await sb
      .from("personal_vacaciones")
      .insert({
        empresa_id: empresaId,
        usuario_id: id,
        tipo,
        fecha_inicio: ini,
        fecha_fin: fin,
        dias: Math.round(dias * 10) / 10,
        motivo,
        estado: "solicitada",
        registrado_por_label: label,
        created_by: usuarioId,
      })
      .select("id")
      .single();
    if (error || !data) return falla(error?.message ?? "No se pudo registrar");
    return ok({ id: (data as { id: string }).id });
  } catch (e) {
    return errorInesperado(e);
  }
}
