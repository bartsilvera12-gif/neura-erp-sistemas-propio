/**
 * QA — Observaciones: estados, severidades y orígenes.
 *
 * Espeja los CHECK de `proyecto_qa_observaciones`
 * (20260811120000_proyecto_qa_observaciones.sql). Si cambia uno, cambia el otro.
 *
 * Módulo isomórfico: lo importan tanto las rutas de API (vía `qa-shared.ts`,
 * que lo re-exporta) como los componentes de la pestaña QA. Por eso no lleva
 * `import "server-only"`: acá sólo hay constantes y helpers puros.
 */

export const QA_ESTADOS = [
  { codigo: "pendiente", label: "Pendiente", corto: "Pend.", color: "#f59e0b" },
  { codigo: "en_curso", label: "En curso", corto: "En curso", color: "#0ea5e9" },
  { codigo: "resuelto", label: "Resuelto", corto: "Resuelto", color: "#22c55e" },
  { codigo: "verificado", label: "Verificado", corto: "Verif.", color: "#4FAEB2" },
  { codigo: "descartado", label: "Descartado", corto: "Descart.", color: "#94a3b8" },
] as const;

export const QA_SEVERIDADES = [
  { codigo: "bloqueante", label: "Bloqueante", corto: "Bloq.", color: "#dc2626" },
  { codigo: "alta", label: "Alta", corto: "Alta", color: "#f97316" },
  { codigo: "media", label: "Media", corto: "Media", color: "#f59e0b" },
  { codigo: "baja", label: "Baja", corto: "Baja", color: "#64748b" },
] as const;

export const QA_ORIGENES = [
  { codigo: "interno", label: "Interno", corto: "Interno", color: "#64748b" },
  { codigo: "cliente", label: "Cliente", corto: "Cliente", color: "#8b5cf6" },
] as const;

export type QAObservacionEstado = (typeof QA_ESTADOS)[number]["codigo"];
export type QAObservacionSeveridad = (typeof QA_SEVERIDADES)[number]["codigo"];
export type QAObservacionOrigen = (typeof QA_ORIGENES)[number]["codigo"];

export const QA_ESTADO_INICIAL: QAObservacionEstado = "pendiente";
export const QA_SEVERIDAD_INICIAL: QAObservacionSeveridad = "media";
export const QA_ORIGEN_INICIAL: QAObservacionOrigen = "interno";

/** Estados que cuentan como "cerrada" a los fines del avance de QA. */
export const QA_ESTADOS_CERRADOS: QAObservacionEstado[] = ["resuelto", "verificado", "descartado"];

/** Estados que siguen pidiendo trabajo (el badge de la pestaña cuenta estos). */
export const QA_ESTADOS_ABIERTOS: QAObservacionEstado[] = ["pendiente", "en_curso"];

const ESTADO_POR_CODIGO = new Map(QA_ESTADOS.map((e) => [e.codigo as string, e] as const));
const SEVERIDAD_POR_CODIGO = new Map(QA_SEVERIDADES.map((s) => [s.codigo as string, s] as const));
const ORIGEN_POR_CODIGO = new Map(QA_ORIGENES.map((o) => [o.codigo as string, o] as const));

const COLOR_NEUTRO = "#94a3b8";

export function esQAEstado(value: unknown): value is QAObservacionEstado {
  return typeof value === "string" && ESTADO_POR_CODIGO.has(value);
}

export function esQASeveridad(value: unknown): value is QAObservacionSeveridad {
  return typeof value === "string" && SEVERIDAD_POR_CODIGO.has(value);
}

export function esQAOrigen(value: unknown): value is QAObservacionOrigen {
  return typeof value === "string" && ORIGEN_POR_CODIGO.has(value);
}

export function qaEstadoLabel(codigo: string | null | undefined): string {
  if (!codigo) return "—";
  return ESTADO_POR_CODIGO.get(codigo)?.label ?? codigo;
}

export function qaEstadoColor(codigo: string | null | undefined): string {
  if (!codigo) return COLOR_NEUTRO;
  return ESTADO_POR_CODIGO.get(codigo)?.color ?? COLOR_NEUTRO;
}

export function qaSeveridadLabel(codigo: string | null | undefined): string {
  if (!codigo) return "—";
  return SEVERIDAD_POR_CODIGO.get(codigo)?.label ?? codigo;
}

export function qaSeveridadColor(codigo: string | null | undefined): string {
  if (!codigo) return COLOR_NEUTRO;
  return SEVERIDAD_POR_CODIGO.get(codigo)?.color ?? COLOR_NEUTRO;
}

export function qaOrigenLabel(codigo: string | null | undefined): string {
  if (!codigo) return "—";
  return ORIGEN_POR_CODIGO.get(codigo)?.label ?? codigo;
}

export function qaOrigenColor(codigo: string | null | undefined): string {
  if (!codigo) return COLOR_NEUTRO;
  return ORIGEN_POR_CODIGO.get(codigo)?.color ?? COLOR_NEUTRO;
}

/** Peso para ordenar por severidad (más grave primero). */
export function qaSeveridadPeso(codigo: string | null | undefined): number {
  const idx = QA_SEVERIDADES.findIndex((s) => s.codigo === codigo);
  return idx === -1 ? QA_SEVERIDADES.length : idx;
}

/** Peso para ordenar por estado (lo que falta hacer primero). */
export function qaEstadoPeso(codigo: string | null | undefined): number {
  const idx = QA_ESTADOS.findIndex((e) => e.codigo === codigo);
  return idx === -1 ? QA_ESTADOS.length : idx;
}

/** Color de sección: hexadecimal de 6 dígitos, igual que el resto de la config visual. */
export const QA_COLOR_HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** `QA-007` — el correlativo tal como se muestra en la UI y en los exports. */
export function qaCodigoObservacion(numero: number): string {
  return `QA-${String(numero).padStart(3, "0")}`;
}
