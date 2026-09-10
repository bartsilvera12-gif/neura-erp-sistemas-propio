/**
 * Límites de día y mes calendario en Paraguay, expresados en ISO UTC para
 * filtrar columnas timestamptz en Postgres.
 *
 * El offset era −04:00 escrito a mano, de cuando Paraguay todavía movía el
 * reloj. Desde 2024 quedó fijo en UTC−3, así que los KPIs del día arrancaban y
 * terminaban una hora corridos. Ahora sale de `TZ_PY`, que es el único lugar
 * donde vive esa decisión.
 */

import { TZ_PY, OFFSET_PY } from "@/lib/format/hora-py";

export function asuncionDayBoundsUtc(now = new Date()): { start: string; end: string } {
  const ymd = now.toLocaleDateString("en-CA", { timeZone: TZ_PY });
  const start = new Date(`${ymd}T00:00:00${OFFSET_PY}`);
  const end = new Date(`${ymd}T23:59:59.999${OFFSET_PY}`);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function asuncionMonthBoundsUtc(now = new Date()): { start: string; end: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ_PY,
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const monthNum = Number(parts.find((p) => p.type === "month")?.value);
  const start = new Date(`${y}-${String(monthNum).padStart(2, "0")}-01T00:00:00${OFFSET_PY}`);
  const nextY = monthNum === 12 ? y + 1 : y;
  const nextM = monthNum === 12 ? 1 : monthNum + 1;
  const end = new Date(
    `${nextY}-${String(nextM).padStart(2, "0")}-01T00:00:00${OFFSET_PY}`
  );
  end.setMilliseconds(end.getMilliseconds() - 1);
  return { start: start.toISOString(), end: end.toISOString() };
}
