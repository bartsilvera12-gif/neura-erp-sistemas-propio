/**
 * Traduce las fallas de la base que el asesor puede llegar a ver.
 *
 * El pool del chat tiene topes por conexión (`lock_timeout`, `statement_timeout`). Cuando
 * saltan, Postgres devuelve un texto críptico; sin traducir, el inbox mostraba un número
 * de error pelado. Estos dos casos NO son un bug del mensaje: es que la fila estaba
 * ocupada en ese instante, así que lo correcto es decirlo y que reintente.
 */
export function mensajeDeBaseOcupada(e: unknown): string | null {
  const texto = e instanceof Error ? e.message : String(e ?? "");
  const codigo = (e as { code?: string } | null)?.code;

  // 55P03 lock_not_available · 57014 query_canceled (statement_timeout)
  if (codigo === "55P03" || /lock timeout|lock_not_available/i.test(texto)) {
    return "La conversación está siendo modificada en este momento. Probá de nuevo en unos segundos.";
  }
  if (codigo === "57014" || /canceling statement due to statement timeout/i.test(texto)) {
    return "La base tardó demasiado en responder. El mensaje NO se envió: probá de nuevo.";
  }
  return null;
}
