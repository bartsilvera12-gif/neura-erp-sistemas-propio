/**
 * Por qué un proyecto necesita atención, y en qué orden.
 *
 * El orden de "Atención PM de hoy" no puede quedar en el frontend: si cada
 * tabla ordena a su gusto, dos pantallas muestran el mismo día en dos órdenes
 * distintos y el PM deja de confiar en la primera fila. Acá se calcula un
 * score único y el motivo que lo explica.
 *
 * El score es una prioridad, no una métrica: sólo importa el orden relativo.
 */

export type MotivoCodigo =
  | "vencido"
  | "bloqueado"
  | "slv_vencido"
  | "vence_pronto"
  | "sin_movimiento"
  | "slv_critico"
  | "estancado"
  | "reingreso_qa"
  | "espera_cliente"
  | "listo_entregar"
  | "slv_riesgo";

export type Motivo = { codigo: MotivoCodigo; label: string; peso: number };

/** Peso base de cada motivo. Un proyecto puede tener varios; gana el más alto. */
const PESOS: Record<MotivoCodigo, number> = {
  vencido: 1000,
  bloqueado: 900,
  slv_vencido: 850,
  vence_pronto: 800,
  sin_movimiento: 700,
  slv_critico: 650,
  estancado: 600,
  reingreso_qa: 500,
  espera_cliente: 400,
  listo_entregar: 300,
  slv_riesgo: 200,
};

export function motivo(codigo: MotivoCodigo, label: string): Motivo {
  return { codigo, label, peso: PESOS[codigo] };
}

/**
 * Los motivos que hablan de un PLAZO: algo ya se pasó de fecha, o está por
 * pasarse.
 *
 * Son dos relojes distintos y los dos cuentan:
 *   · La fecha prometida al cliente — `vencido` y `vence_pronto`.
 *   · El objetivo interno de tiempo (SLV) — `slv_*`, donde "vencido" es que ya
 *     se pasó y "crítico"/"en riesgo" es que está por pasarse.
 *
 * Quedan afuera los que son un problema pero no un plazo: bloqueado, sin
 * movimiento, estancado, rondas de QA, esperando al cliente y listo para
 * entregar. Merecen atención, pero no la de "esto se me vence".
 */
export const MOTIVOS_DE_PLAZO: ReadonlySet<MotivoCodigo> = new Set<MotivoCodigo>([
  "vencido",
  "vence_pronto",
  "slv_vencido",
  "slv_critico",
  "slv_riesgo",
]);

/** El motivo de plazo más grave de un proyecto, o `null` si no tiene ninguno. */
export function motivoDePlazo(motivos: readonly Motivo[]): Motivo | null {
  const deP = motivos.filter((m) => MOTIVOS_DE_PLAZO.has(m.codigo));
  if (deP.length === 0) return null;
  return deP.reduce((a, b) => (b.peso > a.peso ? b : a));
}

/**
 * Score de un proyecto: el motivo más grave manda, y los demás desempatan.
 * Los motivos secundarios suman poco a propósito — tres motivos leves no
 * pueden pasar por encima de un vencido.
 */
export function scorePrioridad(motivos: Motivo[], diasRestantes: number | null): number {
  if (motivos.length === 0) return 0;
  const ordenados = [...motivos].sort((a, b) => b.peso - a.peso);
  const base = ordenados[0].peso;
  const extra = ordenados.slice(1).reduce((a, m) => a + m.peso / 100, 0);
  // A igual motivo, primero lo que vence antes (o lo que lleva más vencido).
  const urgencia = diasRestantes == null ? 0 : Math.max(0, 30 - diasRestantes) / 10;
  return base + extra + urgencia;
}
