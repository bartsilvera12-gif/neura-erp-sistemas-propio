/** Solo dígitos, sin prefijo + */
export function normalizeWaPhone(waId: string): string {
  return waId.replace(/\D/g, "");
}

/**
 * ¿El valor guardado como `phone_number` es un @lid de WhatsApp y NO un teléfono?
 *
 * Contexto: desde WhatsApp 2024+, los chats de clientes que no están agregados a los
 * contactos del celular vinculado llegan identificados con un `@lid` (código interno
 * privado). Si WhatsApp no revela el teléfono real, se guarda el LID como
 * `phone_number` y queda a la vista en el inbox como "117308928352399".
 *
 * Regla: los teléfonos reales caben en 13 dígitos (código país + número); cualquier
 * cosa de 14+ dígitos es casi con seguridad un LID. El caso extremo de 18 dígitos con
 * prefijo `120363...` es directamente un JID de GRUPO de WhatsApp.
 *
 * Si el día de mañana WhatsApp inventa un país con 14+ dígitos, acá se afina.
 */
export function esLidWhatsapp(phone: string | null | undefined): boolean {
  const digits = (phone ?? "").replace(/\D+/g, "");
  if (!digits) return false;
  return digits.length > 13;
}

/**
 * Teléfono mostrable: devuelve `phone` si es un teléfono real, "" si es un LID.
 * El caller decide qué poner en su lugar (nombre del contacto, pushName, placeholder).
 */
export function telefonoLegibleOVacio(phone: string | null | undefined): string {
  const p = (phone ?? "").trim();
  if (!p) return "";
  if (esLidWhatsapp(p)) return "";
  return p;
}

/**
 * Nombre a mostrar en títulos / listados: `nombre` si lo hay, el teléfono si es real,
 * o un placeholder genérico cuando solo tenemos un LID. Reemplaza el patrón repetido
 * `nombre || telefono || "Contacto"` que mostraba el LID basura cuando no había nombre.
 */
export function nombreOTelefonoParaMostrar(
  nombre: string | null | undefined,
  telefono: string | null | undefined,
  fallback = "Cliente de WhatsApp"
): string {
  const n = (nombre ?? "").trim();
  if (n) return n;
  const t = telefonoLegibleOVacio(telefono);
  if (t) return t;
  return fallback;
}
