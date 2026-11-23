/**
 * Quién puede ver el módulo "Propuestas" (armador de propuestas comerciales).
 *
 * Lo ve quien tiene habilitado el módulo CRM Funnel (`MODULO_QUE_HABILITA`): son los que
 * venden. Además, los correos de la lista de abajo lo ven siempre, tengan o no ese módulo
 * (se suman acá o con `NEXT_PUBLIC_PROPUESTAS_EMAILS=uno@x.com,otro@y.com` en Coolify).
 *
 * Es `NEXT_PUBLIC_` a propósito: el menú es un componente de cliente y necesita la misma
 * lista para decidir si muestra el ítem. Eso NO es el permiso: el permiso lo aplica cada
 * API en el servidor (`requirePropuestasAcceso`), con la sesión.
 */
export const MODULO_QUE_HABILITA = "crm";

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
