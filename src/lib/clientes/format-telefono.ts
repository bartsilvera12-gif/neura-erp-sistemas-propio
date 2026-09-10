/**
 * Normaliza un teléfono a la nomenclatura paraguaya `+595 9xx-xxx-xxx`.
 *
 * Toma lo que tipee el asesor, deja solo dígitos, saca el `595` del país si vino, recorta a 9
 * dígitos locales (móvil PY) y los agrupa 3-3-3. Vacío ⇒ cadena vacía (no guarda basura).
 * Se usa en el alta y en la edición de clientes para que la base quede uniforme.
 */
export function formatTelefonoPy(input: string): string {
  let digits = (input || "").replace(/\D/g, "");
  if (digits.startsWith("595")) digits = digits.slice(3);
  digits = digits.slice(0, 9);
  if (!digits) return "";
  const g = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 9)].filter(Boolean);
  return `+595 ${g.join("-")}`;
}
