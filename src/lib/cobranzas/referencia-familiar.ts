/**
 * Referencia de operación para bancos SIN comprobante (ej. Banco Familiar).
 *
 * Familiar no entrega un número de operación, así que los operadores cargaban "000000"
 * (placeholder). Eso rompía la conciliación asistida: varios cobros distintos con el mismo
 * "000000" se agrupaban como si fueran UNA sola transferencia. Solución: cuando el banco no
 * tiene referencia, el sistema genera una única y trazable, así cada cobro queda distinto.
 *
 * Sin dependencias de servidor: se usa tanto en el formulario (cliente) como en el backend
 * (red de seguridad para la API / cargas viejas).
 */

/** Normaliza para comparar: sin acentos, minúsculas, solo alfanumérico. */
function norm(s: string | null | undefined): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Bancos que NO emiten número de operación/comprobante y necesitan referencia generada. */
export function bancoSinReferencia(banco: string | null | undefined): boolean {
  const b = norm(banco);
  return b.includes("famili"); // "Banco Familiar", "Familiar"
}

/**
 * ¿El N° de operación es vacío o un placeholder (solo ceros)? Estos NO deben agruparse ni
 * usarse como referencia real.
 */
export function esOpPlaceholder(op: string | null | undefined): boolean {
  const s = String(op ?? "").replace(/[^a-zA-Z0-9]/g, "");
  return s.length === 0 || /^0+$/.test(s);
}

/** Prefijo corto por banco para la referencia generada. */
function prefijoBanco(banco: string | null | undefined): string {
  return bancoSinReferencia(banco) ? "FAM" : "SR"; // FAM=Familiar, SR=sin referencia
}

/**
 * Genera una referencia única y legible para un banco sin comprobante.
 * Forma: `FAM-YYMMDD-HHMMSS-RR` (fecha/hora de carga + 2 al azar) → única por registro.
 * Al agruparse por operación no colisiona con otros cobros (cada carga es distinta), salvo
 * que se comparta explícitamente en una carga múltiple (misma transferencia, varias facturas).
 */
export function generarReferenciaBanco(banco: string | null | undefined, now: Date = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const yy = p(now.getFullYear() % 100);
  const stamp = `${yy}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 4).toUpperCase();
  return `${prefijoBanco(banco)}-${stamp}-${rand}`;
}

/**
 * Resuelve la referencia a guardar: respeta la que trae el usuario; si está vacía/placeholder
 * y el banco no tiene comprobante, genera una. Devuelve `null` si sigue sin referencia válida
 * (banco que SÍ debería traer op) para que el caller decida el error.
 */
export function resolverReferencia(banco: string | null | undefined, op: string | null | undefined): string | null {
  if (!esOpPlaceholder(op)) return String(op).trim();
  if (bancoSinReferencia(banco)) return generarReferenciaBanco(banco);
  return null;
}
