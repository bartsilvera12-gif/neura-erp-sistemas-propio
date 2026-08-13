/**
 * Etapa de desarrollo — eje propio del tablero "Tareas del equipo".
 *
 * Es independiente del Kanban comercial (`proyecto_estados`, configurable por
 * empresa): acá sólo interesa el avance técnico del proyecto. Al llegar a
 * `finalizado` el proyecto sale del listado activo y pasa al reporte mensual
 * de finalizados por programador.
 *
 * Módulo isomórfico: lo importan tanto las rutas de API como el cliente.
 */

export const PROYECTO_ETAPAS = [
  { codigo: "en_desarrollo", label: "En Desarrollo", corto: "Desarrollo", color: "#8b5cf6" },
  { codigo: "esqueleto_finalizado", label: "Esqueleto Finalizado", corto: "Esqueleto", color: "#0ea5e9" },
  { codigo: "qa", label: "QA", corto: "QA", color: "#f59e0b" },
  { codigo: "finalizado", label: "Finalizado", corto: "Finalizado", color: "#22c55e" },
] as const;

export type ProyectoEtapaDesarrollo = (typeof PROYECTO_ETAPAS)[number]["codigo"];

export const ETAPA_INICIAL: ProyectoEtapaDesarrollo = "en_desarrollo";
export const ETAPA_FINAL: ProyectoEtapaDesarrollo = "finalizado";

/** Etapas que siguen apareciendo en el listado activo del tablero. */
export const ETAPAS_ACTIVAS: ProyectoEtapaDesarrollo[] = PROYECTO_ETAPAS.filter(
  (e) => e.codigo !== ETAPA_FINAL
).map((e) => e.codigo);

const POR_CODIGO = new Map(PROYECTO_ETAPAS.map((e) => [e.codigo as string, e] as const));

export function esEtapaDesarrollo(value: unknown): value is ProyectoEtapaDesarrollo {
  return typeof value === "string" && POR_CODIGO.has(value);
}

export function etapaLabel(codigo: string | null | undefined): string {
  if (!codigo) return "—";
  return POR_CODIGO.get(codigo)?.label ?? codigo;
}

export function etapaColor(codigo: string | null | undefined): string {
  if (!codigo) return "#94a3b8";
  return POR_CODIGO.get(codigo)?.color ?? "#94a3b8";
}

/**
 * Días enteros transcurridos entre dos instantes. Devuelve `null` si la fecha
 * de inicio no es parseable (proyecto sin técnico asignado, por ejemplo).
 */
export function diasTranscurridos(
  desdeIso: string | null | undefined,
  hastaIso?: string | null
): number | null {
  if (typeof desdeIso !== "string" || !desdeIso.trim()) return null;
  const desde = Date.parse(desdeIso);
  if (!Number.isFinite(desde)) return null;
  const hasta =
    typeof hastaIso === "string" && hastaIso.trim() ? Date.parse(hastaIso) : Date.now();
  if (!Number.isFinite(hasta)) return null;
  return Math.max(0, Math.floor((hasta - desde) / 86400000));
}

/** Estado de pausa de un proyecto, tal como lo guarda `proyectos`. */
export type PausaState = {
  pausado_at?: string | null;
  pausa_acumulada_ms?: number | null;
};

/**
 * Milisegundos que el proyecto estuvo pausado hasta `hastaIso` (default: ahora):
 * las pausas ya cerradas más la que esté en curso.
 */
export function msPausados(p: PausaState, hastaIso?: string | null): number {
  const acumulado = Number(p.pausa_acumulada_ms ?? 0);
  const base = Number.isFinite(acumulado) && acumulado > 0 ? acumulado : 0;

  const inicio = typeof p.pausado_at === "string" ? Date.parse(p.pausado_at) : NaN;
  if (!Number.isFinite(inicio)) return base;

  const hasta =
    typeof hastaIso === "string" && hastaIso.trim() ? Date.parse(hastaIso) : Date.now();
  if (!Number.isFinite(hasta)) return base;

  return base + Math.max(0, hasta - inicio);
}

/**
 * Días transcurridos descontando el tiempo pausado — el contador que muestra el
 * tablero. Un proyecto parado esperando al cliente deja de sumar días para no
 * pintarse en rojo como si el programador estuviera atrasado.
 */
export function diasNetos(
  desdeIso: string | null | undefined,
  pausa: PausaState,
  hastaIso?: string | null
): number | null {
  if (typeof desdeIso !== "string" || !desdeIso.trim()) return null;
  const desde = Date.parse(desdeIso);
  if (!Number.isFinite(desde)) return null;
  const hasta =
    typeof hastaIso === "string" && hastaIso.trim() ? Date.parse(hastaIso) : Date.now();
  if (!Number.isFinite(hasta)) return null;
  return Math.max(0, Math.floor((hasta - desde - msPausados(pausa, hastaIso)) / 86400000));
}
