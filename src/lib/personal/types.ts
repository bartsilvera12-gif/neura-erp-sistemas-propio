/** Gestión de Personal (RRHH) — tipos y catálogos compartidos. */

export type TipoIncidencia =
  | "llegada_tardia"
  | "amonestacion"
  | "suspension"
  | "ausencia_justificada"
  | "reconocimiento"
  | "observacion";

export type EstadoIncidencia = "pendiente" | "en_proceso" | "finalizada" | "anulada";

export const TIPOS_INCIDENCIA: TipoIncidencia[] = [
  "llegada_tardia",
  "amonestacion",
  "suspension",
  "ausencia_justificada",
  "reconocimiento",
  "observacion",
];

/** Etiqueta + color del chip (alineado al diseño turquesa del 2.0). */
export const TIPO_INCIDENCIA_META: Record<
  TipoIncidencia,
  { label: string; chip: string; icono: "reloj" | "amonestacion" | "suspension" | "ausencia" | "trofeo" | "observacion" }
> = {
  llegada_tardia: { label: "Llegada tardía", chip: "bg-amber-50 text-amber-700 ring-amber-200", icono: "reloj" },
  amonestacion: { label: "Amonestación", chip: "bg-rose-50 text-rose-700 ring-rose-200", icono: "amonestacion" },
  suspension: { label: "Suspensión", chip: "bg-red-100 text-red-800 ring-red-300", icono: "suspension" },
  ausencia_justificada: { label: "Ausencia justificada", chip: "bg-sky-50 text-sky-700 ring-sky-200", icono: "ausencia" },
  reconocimiento: { label: "Reconocimiento", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200", icono: "trofeo" },
  observacion: { label: "Observación", chip: "bg-slate-100 text-slate-600 ring-slate-200", icono: "observacion" },
};

export const ESTADOS_INCIDENCIA: EstadoIncidencia[] = ["pendiente", "en_proceso", "finalizada", "anulada"];

export const ESTADO_INCIDENCIA_META: Record<EstadoIncidencia, { label: string; chip: string }> = {
  pendiente: { label: "Pendiente", chip: "bg-amber-50 text-amber-700 ring-amber-200" },
  en_proceso: { label: "En proceso", chip: "bg-sky-50 text-sky-700 ring-sky-200" },
  finalizada: { label: "Finalizada", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  anulada: { label: "Anulada", chip: "bg-slate-100 text-slate-500 ring-slate-200" },
};

export function esTipoIncidencia(v: unknown): v is TipoIncidencia {
  return typeof v === "string" && (TIPOS_INCIDENCIA as string[]).includes(v);
}
export function esEstadoIncidencia(v: unknown): v is EstadoIncidencia {
  return typeof v === "string" && (ESTADOS_INCIDENCIA as string[]).includes(v);
}

export type IncidenciaDTO = {
  id: string;
  fecha: string;
  tipo: TipoIncidencia;
  descripcion: string;
  estado: EstadoIncidencia;
  registrado_por: string | null;
  created_at: string;
};

export type DocumentoDTO = {
  id: string;
  nombre: string;
  mime_type: string | null;
  size_bytes: number | null;
  url: string | null;
  created_at: string;
};

export type FuncionarioResumen = {
  id: string;
  nombre: string;
  codigo_empleado: string | null;
  cargo: string | null;
  area: string | null;
  estado: string | null;
  fecha_ingreso: string | null;
  avatar_path: string | null;
  kpis: KpisFuncionario;
};

export type KpisFuncionario = {
  /** % de asistencia (presentes+tarde / días marcados). null si no hay registros. */
  asistencia: number | null;
  llegadas_tardias: number;
  incidencias: number;
  reconocimientos: number;
};

/* ----------------------------------------------------------------- Asistencia */
export type EstadoAsistencia = "presente" | "tarde" | "ausente" | "justificada" | "permiso" | "vacaciones";

export const ESTADOS_ASISTENCIA: EstadoAsistencia[] = [
  "presente", "tarde", "ausente", "justificada", "permiso", "vacaciones",
];

export const ESTADO_ASISTENCIA_META: Record<EstadoAsistencia, { label: string; chip: string; cuenta: boolean }> = {
  // cuenta = si suma como "día marcado con asistencia efectiva" para el %
  presente:    { label: "Presente", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200", cuenta: true },
  tarde:       { label: "Tarde", chip: "bg-amber-50 text-amber-700 ring-amber-200", cuenta: true },
  ausente:     { label: "Ausente", chip: "bg-rose-50 text-rose-700 ring-rose-200", cuenta: false },
  justificada: { label: "Falta justificada", chip: "bg-sky-50 text-sky-700 ring-sky-200", cuenta: false },
  permiso:     { label: "Permiso", chip: "bg-violet-50 text-violet-700 ring-violet-200", cuenta: false },
  vacaciones:  { label: "Vacaciones", chip: "bg-teal-50 text-teal-700 ring-teal-200", cuenta: false },
};

export function esEstadoAsistencia(v: unknown): v is EstadoAsistencia {
  return typeof v === "string" && (ESTADOS_ASISTENCIA as string[]).includes(v);
}

export type AsistenciaDTO = {
  id: string;
  fecha: string;
  estado: EstadoAsistencia;
  hora_entrada: string | null;
  hora_salida: string | null;
  minutos_tarde: number;
  observacion: string | null;
  registrado_por: string | null;
};

export type ResumenAsistencia = {
  dias_marcados: number;
  presentes: number;
  tardes: number;
  ausentes: number;
  justificadas: number;
  porcentaje: number | null;
};

/* ----------------------------------------------------------------- Vacaciones */
export type TipoVacacion = "vacaciones" | "permiso" | "licencia" | "reposo";
export type EstadoVacacion = "solicitada" | "aprobada" | "rechazada" | "anulada" | "gozada";

export const TIPOS_VACACION: TipoVacacion[] = ["vacaciones", "permiso", "licencia", "reposo"];
export const ESTADOS_VACACION: EstadoVacacion[] = ["solicitada", "aprobada", "rechazada", "anulada", "gozada"];

export const TIPO_VACACION_META: Record<TipoVacacion, { label: string }> = {
  vacaciones: { label: "Vacaciones" },
  permiso: { label: "Permiso" },
  licencia: { label: "Licencia" },
  reposo: { label: "Reposo médico" },
};

export const ESTADO_VACACION_META: Record<EstadoVacacion, { label: string; chip: string }> = {
  solicitada: { label: "Solicitada", chip: "bg-amber-50 text-amber-700 ring-amber-200" },
  aprobada:   { label: "Aprobada", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  rechazada:  { label: "Rechazada", chip: "bg-rose-50 text-rose-700 ring-rose-200" },
  anulada:    { label: "Anulada", chip: "bg-slate-100 text-slate-500 ring-slate-200" },
  gozada:     { label: "Gozada", chip: "bg-sky-50 text-sky-700 ring-sky-200" },
};

export function esTipoVacacion(v: unknown): v is TipoVacacion {
  return typeof v === "string" && (TIPOS_VACACION as string[]).includes(v);
}
export function esEstadoVacacion(v: unknown): v is EstadoVacacion {
  return typeof v === "string" && (ESTADOS_VACACION as string[]).includes(v);
}

export type VacacionDTO = {
  id: string;
  tipo: TipoVacacion;
  fecha_inicio: string;
  fecha_fin: string;
  dias: number;
  motivo: string | null;
  estado: EstadoVacacion;
  aprobado_por: string | null;
  aprobado_at: string | null;
  created_at: string;
};

export type SaldoVacaciones = {
  anio: number;
  anuales: number;
  gozados: number;
  aprobados: number;
  disponibles: number;
};

/* ------------------------------------------------------------------ Desempeño */
export type Competencia = { nombre: string; puntaje: number };

export type EvaluacionDTO = {
  id: string;
  periodo: string;
  fecha: string;
  puntaje: number | null;
  competencias: Competencia[];
  fortalezas: string | null;
  mejoras: string | null;
  comentario: string | null;
  evaluador: string | null;
  estado: "borrador" | "finalizada";
  created_at: string;
};

/* ------------------------------------------------------------------ Historial */
export type TipoEventoHistorial = "incidencia" | "asistencia" | "vacacion" | "evaluacion" | "documento";

export type EventoHistorial = {
  id: string;
  tipo: TipoEventoHistorial;
  fecha: string;
  titulo: string;
  detalle: string | null;
  chip: string | null;
  autor: string | null;
};

export type FichaFuncionario = {
  id: string;
  nombre: string;
  email: string | null;
  telefono: string | null;
  codigo_empleado: string | null;
  cargo: string | null;
  area: string | null;
  modalidad: string | null;
  estado: string | null;
  rol: string | null;
  fecha_ingreso: string | null;
  fecha_nacimiento: string | null;
  tipo_contrato: string | null;
  dias_vacaciones_anuales: number | null;
  avatar_path: string | null;
  supervisor: { id: string; nombre: string } | null;
  kpis: KpisFuncionario;
};
