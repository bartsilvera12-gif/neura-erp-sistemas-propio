/**
 * Formato de montos y fechas compartido por los gráficos y los reportes (cliente y servidor).
 * Todo en guaraníes, separador de miles es-PY, fechas YYYY-MM-DD de Paraguay.
 */
export const gs = (n: number | null | undefined) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;
export const usd = (n: number | null | undefined) =>
  `USD ${(Number(n) || 0).toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Número entero con separador de miles (sin "Gs."). */
export const num = (n: number | null | undefined, dec = 0) =>
  (Number(n) || 0).toLocaleString("es-PY", { maximumFractionDigits: dec });

/** Monto corto para ejes y etiquetas: 1,2 M · 850 k. */
export function corto(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toLocaleString("es-PY", { maximumFractionDigits: 1 })} mil M`;
  if (a >= 1e6) return `${(n / 1e6).toLocaleString("es-PY", { maximumFractionDigits: 1 })} M`;
  if (a >= 1e3) return `${Math.round(n / 1e3).toLocaleString("es-PY")} k`;
  return Math.round(n).toLocaleString("es-PY");
}

/** Porcentaje "12,3 %" (o "—" sin base). */
export const pct = (a: number, b: number, dec = 1) =>
  b ? `${((a / b) * 100).toLocaleString("es-PY", { minimumFractionDigits: dec, maximumFractionDigits: dec })} %` : "—";

/** Variación relativa (null si no hay base). */
export const variacion = (actual: number, anterior: number) => (anterior > 0 ? ((actual - anterior) / anterior) * 100 : null);

export const fechaCorta = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");
export const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const DIAS_CORTOS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
export const nombreMes = (ymd: string) => `${MESES[Number(ymd.slice(5, 7)) - 1]} ${ymd.slice(0, 4)}`;
export const mesCorto = (ymd: string) => `${MESES_CORTOS[Number(ymd.slice(5, 7)) - 1]} ${ymd.slice(2, 4)}`;
/** "mar 14/10" */
export const diaSemana = (ymd: string) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  return `${DIAS_CORTOS[d.getUTCDay()]} ${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
};
/** "martes 14 de octubre de 2026" */
export const diaLargo = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString("es-PY", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });
/** Primera letra en mayúscula ("jueves, 15 de octubre" → "Jueves, 15 de octubre"). */
export const mayuscula = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const horaPY = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString("es-PY", { timeZone: "America/Asuncion", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : "—";
export const fechaHoraPY = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).replace(",", "")
    : "—";
