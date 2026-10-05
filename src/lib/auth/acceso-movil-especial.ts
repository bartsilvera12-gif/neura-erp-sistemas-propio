/**
 * Acceso móvil especial para usuarios de dirección/seguimiento.
 *
 * Se usa únicamente para habilitar las vistas móviles de Proyectos, Soporte y Avisos
 * sin convertir al usuario en administrador general del ERP.
 */
const EMAILS_ACCESO_MOVIL_ESPECIAL = new Set([
  "milagrosgomezlujan26@gmail.com",
]);

export function tieneAccesoMovilEspecial(email: string | null | undefined): boolean {
  return EMAILS_ACCESO_MOVIL_ESPECIAL.has((email ?? "").trim().toLowerCase());
}
