/**
 * Presentación de nombres de personas.
 *
 * Los nombres vienen en MAYÚSCULAS desde el catálogo de usuarios. En una lista
 * o en una ficha eso grita y además es más lento de leer, así que se muestran
 * en capitular. Las partículas ("de", "del", "da"…) quedan en minúscula, como
 * en un nombre bien escrito.
 */

const PARTICULAS = new Set(["de", "del", "la", "las", "los", "da", "do", "dos", "y", "e"]);

export function nombreCapitular(name: string | null | undefined): string {
  const limpio = (name ?? "").trim();
  if (!limpio) return "—";
  // Si ya viene en mixto (no está todo en mayúsculas) se respeta tal cual: el
  // usuario puede haberlo escrito a propósito.
  if (limpio !== limpio.toUpperCase()) return limpio;
  return limpio
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && PARTICULAS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/** Iniciales para un avatar: dos letras a partir del nombre y el apellido. */
export function inicialesNombre(name: string | null | undefined): string {
  const limpio = (name ?? "").trim();
  if (!limpio) return "?";
  const partes = limpio.split(/\s+/).filter(Boolean);
  if (partes.length >= 2) return `${partes[0][0]}${partes[1][0]}`.toUpperCase();
  return limpio.slice(0, 2).toUpperCase();
}

/**
 * Nombre corto para espacios angostos: nombre + primer apellido, capitular.
 * "IVAN RODRIGO GONZALEZ GONZALEZ" → "Ivan Rodrigo".
 */
export function nombreCorto(name: string | null | undefined): string {
  const capitular = nombreCapitular(name);
  if (capitular === "—") return capitular;
  const partes = capitular.split(/\s+/).filter(Boolean);
  return partes.slice(0, 2).join(" ");
}
