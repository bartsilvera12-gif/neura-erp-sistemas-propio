/**
 * Quién puede ver el módulo "Propuestas" (armador de propuestas comerciales).
 *
 * ÚNICO lugar donde se define la lista. Mientras el módulo está en prueba lo ven
 * solo estos correos. Para sumar gente: agregar el correo acá (y desplegar) o
 * definir `NEXT_PUBLIC_PROPUESTAS_EMAILS=uno@x.com,otro@y.com` en Coolify.
 *
 * Es `NEXT_PUBLIC_` a propósito: el menú es un componente de cliente y necesita
 * la misma lista para decidir si muestra el ítem. Eso NO es el permiso: el
 * permiso lo aplica cada API en el servidor, con el correo de la sesión.
 */
const PERMITIDOS = new Set(["ivanchtareas@gmail.com", "admin-temporal@neura.com"]);

export function puedeVerPropuestas(email: string | null | undefined): boolean {
  const e = email?.trim().toLowerCase();
  if (!e) return false;
  if (PERMITIDOS.has(e)) return true;
  const extra = (process.env.NEXT_PUBLIC_PROPUESTAS_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return extra.includes(e);
}
