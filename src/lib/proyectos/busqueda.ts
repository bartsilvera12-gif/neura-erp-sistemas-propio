/**
 * Búsqueda de texto de los tableros de Proyectos.
 *
 * Reglas, pensadas para cómo busca la gente y no para cómo compara una base de
 * datos:
 *
 *  - Sin acentos: "caacupe" encuentra "CAACUPÉ".
 *  - Sin distinguir mayúsculas.
 *  - Por tokens y sin orden: "karen web" encuentra los Proyecto Web de Karen,
 *    aunque en el texto el nombre venga después del tipo.
 *  - Sin puntuación: "s.r.l" encuentra "SRL", y "e.a.s" encuentra "EAS".
 *
 * Módulo isomórfico y sin dependencias: lo usan tanto los filtros del cliente
 * como cualquier rutina del servidor que necesite el mismo criterio.
 */

/**
 * Texto comparable: sin acentos, en minúsculas, con la puntuación convertida en
 * separador y los espacios colapsados.
 *
 * La puntuación se reemplaza por espacio en vez de borrarse: si se borrara,
 * "S.R.L" y "SRL" colapsarían igual pero "Pablo-Arturo" quedaría como
 * "pabloarturo" y dejaría de encontrarse escribiendo "arturo".
 */
export function normalizarTexto(valor: string | null | undefined): string {
  if (!valor) return "";
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, " ")
    .trim();
}

/**
 * Tokens de la consulta. Devuelve `[]` cuando no hay nada que buscar, que es lo
 * que hace que `coincideBusqueda` deje pasar todo sin filtrar.
 */
export function tokenizarBusqueda(consulta: string | null | undefined): string[] {
  const n = normalizarTexto(consulta);
  return n ? n.split(" ").filter(Boolean) : [];
}

/**
 * ¿El texto contiene TODOS los tokens? Cada token puede coincidir en cualquier
 * parte de cualquier palabra, para que escribir de a poco vaya angostando el
 * resultado en vez de vaciarlo.
 *
 * Se compara contra DOS versiones del texto, y alcanza con que una dé:
 *
 *  - Separada ("tradexpark s r l"): mantiene los límites de palabra, y es la
 *    que hace que "arturo" encuentre "Pablo-Arturo".
 *  - Compactada ("tradexparksrl"): sin espacios ni puntuación, y es la que hace
 *    que escribir "srl" encuentre "S.R.L" y "eas" encuentre "E.A.S".
 *
 * Con una sola no alcanza: la separada falla en el caso de las siglas con
 * puntos, que en estos datos son la mayoría de las razones sociales.
 */
export function coincideTokens(tokens: string[], texto: string): boolean {
  if (tokens.length === 0) return true;
  const separado = normalizarTexto(texto);
  const compacto = separado.replace(/ /g, "");
  return tokens.every((t) => separado.includes(t) || compacto.includes(t));
}

/** Igual que `coincideTokens`, pero normalizando el texto en el momento. */
export function coincideBusqueda(tokens: string[], texto: string): boolean {
  return coincideTokens(tokens, texto);
}
