/**
 * Etapa de QA — eje propio de la persona que revisa y prueba los proyectos.
 *
 * Es independiente de `etapa_desarrollo` (ver `etapas-desarrollo.ts`): el
 * programador y QA avanzan en paralelo sobre el mismo proyecto, así que el
 * proyecto aparece a la vez en la tarjeta del programador con su etapa de
 * desarrollo y en la de QA con su etapa de QA.
 *
 * El flujo es: se le asigna QA -> `revision_pre_entrega` (revisa contra el
 * brief y prueba), si encuentra algo pasa a `cambios` (el programador corrige),
 * vuelve a revisar y cierra en `finalizado`. Al llegar a `finalizado` sale del
 * bloque activo de QA; el proyecto sigue vivo en la tarjeta del programador
 * hasta que éste lo marque finalizado.
 *
 * Módulo isomórfico: lo importan tanto las rutas de API como el cliente.
 */

export const QA_ETAPAS = [
  { codigo: "revision_pre_entrega", label: "Revisión pre-entrega", corto: "Pre-entrega", color: "#6366f1" },
  { codigo: "cambios", label: "Cambios", corto: "Cambios", color: "#f97316" },
  { codigo: "finalizado", label: "Finalizado", corto: "Finalizado", color: "#22c55e" },
] as const;

export type ProyectoEtapaQA = (typeof QA_ETAPAS)[number]["codigo"];

/** Al asignar QA el proyecto entra directo a revisión: es lo primero que hace. */
export const QA_ETAPA_INICIAL: ProyectoEtapaQA = "revision_pre_entrega";
export const QA_ETAPA_FINAL: ProyectoEtapaQA = "finalizado";

/** Etapas que siguen apareciendo en el bloque activo de QA del tablero. */
export const QA_ETAPAS_ACTIVAS: ProyectoEtapaQA[] = QA_ETAPAS.filter(
  (e) => e.codigo !== QA_ETAPA_FINAL
).map((e) => e.codigo);

const POR_CODIGO = new Map(QA_ETAPAS.map((e) => [e.codigo as string, e] as const));

export function esEtapaQA(value: unknown): value is ProyectoEtapaQA {
  return typeof value === "string" && POR_CODIGO.has(value);
}

export function qaEtapaLabel(codigo: string | null | undefined): string {
  if (!codigo) return "—";
  return POR_CODIGO.get(codigo)?.label ?? codigo;
}

export function qaEtapaColor(codigo: string | null | undefined): string {
  if (!codigo) return "#94a3b8";
  return POR_CODIGO.get(codigo)?.color ?? "#94a3b8";
}
