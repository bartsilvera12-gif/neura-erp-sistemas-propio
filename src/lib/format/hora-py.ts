/**
 * Formateo de fecha y hora en el huso de Paraguay.
 *
 * POR QUÉ EXISTE: `new Date(iso).getHours()` devuelve la hora en el huso del
 * PROCESO. En el navegador del usuario eso coincide con Paraguay, pero en el
 * servidor (que corre en UTC) da 3 horas de más: una reunión de las 10:00 se
 * anunciaba como "13:00" en la campanita.
 *
 * Regla: cualquier código que corra en el servidor y muestre una hora al
 * usuario tiene que pasar por acá, nunca por los getters locales de `Date`.
 *
 * Paraguay dejó de aplicar horario de verano en 2024 y quedó fijo en UTC-3,
 * pero igual se usa el nombre del huso y no un offset fijo: si eso cambiara,
 * `Intl` ya lo sabe y el código no.
 */

export const TZ_PY = "America/Asuncion";

/** "10:00" en hora de Paraguay. */
export function horaPY(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString("es-PY", {
    timeZone: TZ_PY,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * "21/08" en hora de Paraguay.
 *
 * Se arma con `formatToParts` y no con `toLocaleString`: el locale `es-PY`
 * ignora el `2-digit` del mes y devuelve "21/8", que rompe la alineación en
 * cualquier listado. Acá el relleno se aplica a mano y el resultado es siempre
 * de dos dígitos.
 */
export function diaMesPY(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const partes = new Intl.DateTimeFormat("es-PY", {
    timeZone: TZ_PY,
    day: "2-digit",
    month: "2-digit",
  }).formatToParts(d);
  const dia = partes.find((p) => p.type === "day")?.value ?? "";
  const mes = partes.find((p) => p.type === "month")?.value ?? "";
  return `${dia.padStart(2, "0")}/${mes.padStart(2, "0")}`;
}

/**
 * ISO -> "YYYY-MM-DDTHH:mm" para un `<input type="datetime-local">`.
 *
 * El input habla la hora LOCAL del navegador y sin zona, así que no sirve
 * `toISOString()` (daría UTC y mostraría otra hora). Es el inverso de
 * `new Date(valorDelInput)`, que es cómo se vuelve a ISO al guardar.
 */
export function isoAInputDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
