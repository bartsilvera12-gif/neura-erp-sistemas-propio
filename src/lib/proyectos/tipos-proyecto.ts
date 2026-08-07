/**
 * Códigos de `proyecto_tipos` con comportamiento propio en la UI.
 *
 * El tipo mixto (`web_saas`) no es una tercera variante con reglas nuevas: es
 * los dos a la vez. Por eso el resto del código nunca debe comparar el código
 * contra `"web"` o `"saas"` directamente —usá estos predicados— o el mixto
 * queda afuera de una de las dos mitades.
 *
 * Módulo isomórfico: lo importan rutas de API y componentes cliente.
 */

export const TIPO_PROYECTO_WEB = "web";
export const TIPO_PROYECTO_SAAS = "saas";
export const TIPO_PROYECTO_WEB_SAAS = "web_saas";

/** ¿El proyecto tiene parte de página web (brief de marca, dominio, hosting…)? */
export function tipoIncluyeWeb(codigo: string | null | undefined): boolean {
  return codigo === TIPO_PROYECTO_WEB || codigo === TIPO_PROYECTO_WEB_SAAS;
}

/** ¿El proyecto tiene parte de SaaS/ERP (brief de módulos, empresa, WhatsApp…)? */
export function tipoIncluyeSaas(codigo: string | null | undefined): boolean {
  return codigo === TIPO_PROYECTO_SAAS || codigo === TIPO_PROYECTO_WEB_SAAS;
}

/** Sólo el mixto: sirve para etiquetar o para decidir si se guardan ambos briefs. */
export function tipoEsMixto(codigo: string | null | undefined): boolean {
  return codigo === TIPO_PROYECTO_WEB_SAAS;
}
