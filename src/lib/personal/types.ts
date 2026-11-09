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
  /** % de asistencia. null hasta la Fase 2 (módulo de Asistencia). */
  asistencia: number | null;
  llegadas_tardias: number;
  incidencias: number;
  reconocimientos: number;
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
  avatar_path: string | null;
  supervisor: { id: string; nombre: string } | null;
  kpis: KpisFuncionario;
};
