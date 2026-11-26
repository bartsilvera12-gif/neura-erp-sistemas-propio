/**
 * Venta a crédito en cuotas (receta 98). Mismo cálculo que tg_ventas_cxc en la base:
 *   · la 1ª cuota vence a `plazoDias` de hoy; las siguientes cada mes (mismo día; si el mes es
 *     más corto, el último día), cada 15 días o cada 7 días;
 *   · montos iguales (Gs. enteros) y la última absorbe el redondeo.
 * Cada cuota es una cuenta por cobrar propia (cobros, cobranza y reportes las ven una por una).
 */

export type CadaCuota = "mes" | "quincena" | "semana";

export const OPCIONES_CADA: [CadaCuota, string][] = [["mes", "Mensual"], ["quincena", "Quincenal"], ["semana", "Semanal"]];
const ADJ: Record<CadaCuota, [string, string]> = { mes: ["mensual", "mensuales"], quincena: ["quincenal", "quincenales"], semana: ["semanal", "semanales"] };

/** Tope absoluto (receta 131). El de cada empresa (120 por defecto) viene de /api/cuotas/planes: ver usePlanesCuota. */
export const MAX_CUOTAS = 360;

/** Plan de cuotas de la empresa (receta 131; recargo_pct, receta 137). */
export type PlanCuota = { id: string; nombre: string; cuotas: number; cada: CadaCuota; primera_dias: number; entrega_pct: number; recargo_pct?: number; activo: boolean };

/** Receta 137: el recargo del plan sobre lo financiado (igual que la base: redondeado a guaraníes). */
export const recargoPlan = (financiado: number, plan: Pick<PlanCuota, "recargo_pct"> | null | undefined) =>
  plan && Number(plan.recargo_pct) > 0 && financiado > 0 ? Math.round(financiado * Number(plan.recargo_pct) / 100) : 0;
export type PlanesCuota = { max_cuotas: number; planes: PlanCuota[] };

/** Suma meses como Postgres (31/01 + 1 mes = 28/02). */
function sumarMeses(d: Date, meses: number): Date {
  const y = d.getFullYear(), m = d.getMonth() + meses, dia = d.getDate();
  const ultimo = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(dia, ultimo));
}

export type Cuota = { n: number; monto: number; vence: Date };

export function planCuotas(total: number, cuotas: number, plazoDias: number, cada: CadaCuota, desde = new Date()): Cuota[] {
  const n = Math.max(1, Math.min(MAX_CUOTAS, Math.floor(cuotas) || 1));
  const base = Math.trunc((Number(total) || 0) / n);
  const primera = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate() + (plazoDias || 0));
  const out: Cuota[] = [];
  for (let i = 1; i <= n; i++) {
    const vence = cada === "quincena" ? new Date(primera.getFullYear(), primera.getMonth(), primera.getDate() + 15 * (i - 1))
      : cada === "semana" ? new Date(primera.getFullYear(), primera.getMonth(), primera.getDate() + 7 * (i - 1))
      : sumarMeses(primera, i - 1);
    out.push({ n: i, monto: i === n ? (Number(total) || 0) - base * (n - 1) : base, vence });
  }
  return out;
}

export const fechaCorta = (d: Date) => d.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" });

/** "Crédito · 30 días" · "Crédito · 3 cuotas mensuales (1ª a 30 días)". */
export function textoCredito(plazoDias: number | null | undefined, cuotas: number | null | undefined, cada: string | null | undefined): string {
  const n = Math.max(1, Number(cuotas) || 1);
  const p = Number(plazoDias) || 0;
  if (n === 1) return p > 0 ? `Crédito · ${p} día${p === 1 ? "" : "s"}` : "Crédito";
  const adj = ADJ[(cada as CadaCuota) in ADJ ? (cada as CadaCuota) : "mes"][1];
  return `Crédito · ${n} cuotas ${adj}${p > 0 ? ` (1ª a ${p} día${p === 1 ? "" : "s"})` : ""}`;
}
