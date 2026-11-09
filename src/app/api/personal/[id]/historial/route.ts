import { requirePersonalApi, ok, falla, errorInesperado } from "@/lib/personal/servidor";
import {
  ESTADO_ASISTENCIA_META, TIPO_INCIDENCIA_META, TIPO_VACACION_META, ESTADO_VACACION_META,
  type EstadoAsistencia, type EstadoVacacion, type EventoHistorial, type TipoIncidencia, type TipoVacacion,
} from "@/lib/personal/types";

const UUID = /^[0-9a-f-]{36}$/i;
type Params = { params: Promise<{ id: string }> };

/** GET /api/personal/:id/historial — línea de tiempo unificada (incidencias, asistencia, vacaciones, desempeño, documentos). */
export async function GET(request: Request, { params }: Params) {
  const auth = await requirePersonalApi(request);
  if (!auth.ok) return auth.respuesta;
  const { empresaId, sb } = auth.ctx;
  try {
    const { id } = await params;
    if (!UUID.test(id)) return falla("Funcionario inválido");

    const base = { empresa_id: empresaId, usuario_id: id };
    const [inc, asis, vac, evals, docs] = await Promise.all([
      sb.from("personal_incidencias").select("id, fecha, tipo, descripcion, estado, registrado_por_label, created_at")
        .match(base).neq("estado", "anulada").order("fecha", { ascending: false }).limit(60),
      sb.from("personal_asistencia").select("id, fecha, estado, minutos_tarde, observacion, created_at")
        .match(base).in("estado", ["tarde", "ausente", "justificada"]).order("fecha", { ascending: false }).limit(60),
      sb.from("personal_vacaciones").select("id, tipo, fecha_inicio, fecha_fin, dias, estado, created_at")
        .match(base).order("fecha_inicio", { ascending: false }).limit(40),
      sb.from("personal_evaluaciones").select("id, periodo, fecha, puntaje, created_at")
        .match(base).order("fecha", { ascending: false }).limit(40),
      sb.from("personal_documentos").select("id, nombre, created_at").match(base).order("created_at", { ascending: false }).limit(40),
    ]);

    const eventos: EventoHistorial[] = [];

    for (const r of (inc.data ?? []) as { id: string; fecha: string; tipo: TipoIncidencia; descripcion: string; registrado_por_label: string | null; created_at: string }[]) {
      const meta = TIPO_INCIDENCIA_META[r.tipo];
      eventos.push({ id: `inc-${r.id}`, tipo: "incidencia", fecha: r.fecha, titulo: meta?.label ?? "Incidencia", detalle: r.descripcion, chip: meta?.chip ?? null, autor: r.registrado_por_label });
    }
    for (const r of (asis.data ?? []) as { id: string; fecha: string; estado: EstadoAsistencia; minutos_tarde: number; observacion: string | null; created_at: string }[]) {
      const meta = ESTADO_ASISTENCIA_META[r.estado];
      const detalle = r.estado === "tarde" && r.minutos_tarde ? `${r.minutos_tarde} min de atraso${r.observacion ? ` · ${r.observacion}` : ""}` : r.observacion;
      eventos.push({ id: `asis-${r.id}`, tipo: "asistencia", fecha: r.fecha, titulo: meta?.label ?? "Asistencia", detalle, chip: meta?.chip ?? null, autor: null });
    }
    for (const r of (vac.data ?? []) as { id: string; tipo: TipoVacacion; fecha_inicio: string; fecha_fin: string; dias: number; estado: EstadoVacacion; created_at: string }[]) {
      const tm = TIPO_VACACION_META[r.tipo];
      const em = ESTADO_VACACION_META[r.estado];
      eventos.push({ id: `vac-${r.id}`, tipo: "vacacion", fecha: r.fecha_inicio, titulo: `${tm?.label ?? "Vacaciones"} · ${em?.label ?? r.estado}`, detalle: `${r.fecha_inicio} a ${r.fecha_fin} (${Number(r.dias)} días)`, chip: em?.chip ?? null, autor: null });
    }
    for (const r of (evals.data ?? []) as { id: string; periodo: string; fecha: string; puntaje: number | null; created_at: string }[]) {
      eventos.push({ id: `eval-${r.id}`, tipo: "evaluacion", fecha: r.fecha, titulo: `Evaluación de desempeño · ${r.periodo}`, detalle: r.puntaje != null ? `Puntaje ${Number(r.puntaje)} / 5` : null, chip: "bg-indigo-50 text-indigo-700 ring-indigo-200", autor: null });
    }
    for (const r of (docs.data ?? []) as { id: string; nombre: string; created_at: string }[]) {
      eventos.push({ id: `doc-${r.id}`, tipo: "documento", fecha: r.created_at.slice(0, 10), titulo: "Documento cargado", detalle: r.nombre, chip: "bg-slate-100 text-slate-600 ring-slate-200", autor: null });
    }

    eventos.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
    return ok({ eventos: eventos.slice(0, 120) });
  } catch (e) {
    return errorInesperado(e);
  }
}
