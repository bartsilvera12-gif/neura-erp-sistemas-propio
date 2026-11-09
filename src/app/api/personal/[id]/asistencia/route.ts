import { requirePersonalApi, ok, falla, errorInesperado, resumenAsistencia, nombresPorId } from "@/lib/personal/servidor";
import { esEstadoAsistencia, type AsistenciaDTO } from "@/lib/personal/types";

const UUID = /^[0-9a-f-]{36}$/i;
type Params = { params: Promise<{ id: string }> };

/** Primer día del mes YYYY-MM; si no viene, los últimos 90 días. */
function desdeFiltro(sp: URLSearchParams): string {
  const mes = sp.get("mes"); // "YYYY-MM"
  if (mes && /^\d{4}-\d{2}$/.test(mes)) return `${mes}-01`;
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return d.toISOString().slice(0, 10);
}
function hastaFiltro(sp: URLSearchParams): string | null {
  const mes = sp.get("mes");
  if (mes && /^\d{4}-\d{2}$/.test(mes)) {
    const [y, m] = mes.split("-").map(Number);
    const fin = new Date(y, m, 0); // último día del mes
    return fin.toISOString().slice(0, 10);
  }
  return null;
}

/** GET /api/personal/:id/asistencia?mes=YYYY-MM */
export async function GET(request: Request, { params }: Params) {
  const auth = await requirePersonalApi(request);
  if (!auth.ok) return auth.respuesta;
  const { empresaId, sb } = auth.ctx;
  try {
    const { id } = await params;
    if (!UUID.test(id)) return falla("Funcionario inválido");
    const sp = new URL(request.url).searchParams;
    const desde = desdeFiltro(sp);
    const hasta = hastaFiltro(sp);

    let q = sb
      .from("personal_asistencia")
      .select("id, fecha, estado, hora_entrada, hora_salida, minutos_tarde, observacion, registrado_por_label, registrado_por_id")
      .eq("empresa_id", empresaId)
      .eq("usuario_id", id)
      .gte("fecha", desde)
      .order("fecha", { ascending: false });
    if (hasta) q = q.lte("fecha", hasta);

    const { data, error } = await q;
    if (error) return falla(error.message);
    const filas = (data ?? []) as {
      id: string; fecha: string; estado: AsistenciaDTO["estado"]; hora_entrada: string | null;
      hora_salida: string | null; minutos_tarde: number; observacion: string | null;
      registrado_por_label: string | null; registrado_por_id: string | null;
    }[];

    const faltan = filas.filter((f) => !f.registrado_por_label && f.registrado_por_id).map((f) => f.registrado_por_id);
    const nombres = faltan.length ? await nombresPorId(sb, empresaId, faltan) : new Map<string, string>();

    const asistencias: AsistenciaDTO[] = filas.map((f) => ({
      id: f.id,
      fecha: f.fecha,
      estado: f.estado,
      hora_entrada: f.hora_entrada,
      hora_salida: f.hora_salida,
      minutos_tarde: f.minutos_tarde ?? 0,
      observacion: f.observacion,
      registrado_por: f.registrado_por_label ?? (f.registrado_por_id ? nombres.get(f.registrado_por_id) ?? null : null),
    }));

    // Resumen del mismo rango (o 90 días) para las tarjetas.
    const resumen = await resumenAsistencia(sb, empresaId, id, desde);
    return ok({ asistencias, resumen });
  } catch (e) {
    return errorInesperado(e);
  }
}

/** POST /api/personal/:id/asistencia — registra/actualiza la marca de un día (upsert por día). */
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
    if (!esEstadoAsistencia(body.estado)) return falla("Elegí el estado de la jornada");
    const fecha = typeof body.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.fecha) ? body.fecha : null;
    if (!fecha) return falla("Fecha inválida");
    const hhmm = (v: unknown) => (typeof v === "string" && /^\d{2}:\d{2}$/.test(v) ? v : null);
    const horaEntrada = hhmm(body.hora_entrada);
    const horaSalida = hhmm(body.hora_salida);
    const minutos = Number.isFinite(Number(body.minutos_tarde)) ? Math.max(0, Math.round(Number(body.minutos_tarde))) : 0;
    const observacion = typeof body.observacion === "string" ? body.observacion.trim().slice(0, 2000) || null : null;
    const label = usuarioId ? (await nombresPorId(sb, empresaId, [usuarioId])).get(usuarioId) ?? null : null;

    const fila = {
      empresa_id: empresaId,
      usuario_id: id,
      fecha,
      estado: body.estado,
      hora_entrada: horaEntrada,
      hora_salida: horaSalida,
      minutos_tarde: body.estado === "tarde" ? minutos : 0,
      observacion,
      registrado_por_id: usuarioId,
      registrado_por_label: label,
      created_by: usuarioId,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await sb
      .from("personal_asistencia")
      .upsert(fila, { onConflict: "usuario_id,fecha" })
      .select("id")
      .single();
    if (error || !data) return falla(error?.message ?? "No se pudo registrar");
    return ok({ id: (data as { id: string }).id });
  } catch (e) {
    return errorInesperado(e);
  }
}
