/**
 * Fuente de VERDAD del "nombre del cliente para mostrar".
 *
 * Regla de negocio (type-aware):
 *  - tipo_cliente = "empresa"  → el cliente real es la COMPAÑÍA → se muestra `empresa`.
 *                                La persona de contacto es un dato secundario (útil para
 *                                búsquedas), NO el nombre principal.
 *  - tipo_cliente = "persona"  → el cliente ES la persona → se muestra su nombre completo
 *                                (guardado en `nombre_contacto`).
 *
 * `razon_social` NO define el display: es el nombre fiscal para la FACTURA (SIFEN) y solo
 * se usa como último recurso antes del fallback.
 *
 * IMPORTANTE: este es el único lugar donde se decide el criterio. Todo el sistema (APIs,
 * front web/mobile/desktop) debe usar `nombreClienteDisplay` (TS) o `clienteDisplayNameSql`
 * (para queries que resuelven el nombre en SQL). Así el mismo cliente se ve igual en todos
 * lados. No reimplementar el fallback a mano en cada pantalla.
 *
 * Nota de datos: en `neura.clientes` las columnas `nombre` y `nombre_contacto` están
 * duplicadas (mismo valor). El helper acepta ambas y usa la que venga.
 */

/** Forma mínima que necesita el helper. Compatible con `Cliente` y con filas crudas de la DB. */
export interface ClienteNombreParts {
  tipo_cliente?: string | null;
  empresa?: string | null;
  nombre_contacto?: string | null;
  /** Columna legacy duplicada de `nombre_contacto` en la DB. */
  nombre?: string | null;
  razon_social?: string | null;
}

/**
 * Entrada aceptada por los helpers: la forma tipada `ClienteNombreParts` o una fila cruda de
 * la DB (`Record<string, unknown>`). Los valores se normalizan igual, así los callers que ya
 * tienen `Record<string, unknown>` (queries genéricas) no necesitan castear.
 */
export type ClienteNombreInput = ClienteNombreParts | Record<string, unknown> | null | undefined;

/** Trim + colapsa vacío a null. */
function norm(v: unknown): string | null {
  const s = (v ?? "").toString().trim();
  return s.length > 0 ? s : null;
}

/**
 * Nombre del cliente para MOSTRAR en cualquier pantalla o listado.
 * @param fallback texto cuando no hay ningún nombre cargado (default "Cliente").
 */
export function nombreClienteDisplay(c: ClienteNombreInput, fallback = "Cliente"): string {
  const empresa = norm(c?.empresa);
  // `nombre` y `nombre_contacto` son la misma cosa en la DB; tomamos la que exista.
  const contacto = norm(c?.nombre_contacto) ?? norm(c?.nombre);
  const razon = norm(c?.razon_social);
  const tipo = norm(c?.tipo_cliente)?.toLowerCase();

  if (tipo === "persona") {
    // La persona ES el cliente.
    return contacto ?? empresa ?? razon ?? fallback;
  }
  // "empresa" o desconocido: la compañía es el cliente; el contacto es secundario.
  return empresa ?? contacto ?? razon ?? fallback;
}

/**
 * Nombre del CONTACTO (dato secundario), solo cuando aporta info distinta al display.
 * Útil para subtítulos y como campo de búsqueda. Devuelve null si coincide con el display
 * (p. ej. en personas, donde el contacto ES el nombre principal) o si no hay contacto.
 */
export function nombreClienteContacto(c: ClienteNombreInput): string | null {
  const contacto = norm(c?.nombre_contacto) ?? norm(c?.nombre);
  if (!contacto) return null;
  const display = nombreClienteDisplay(c, "");
  return contacto === display ? null : contacto;
}

/**
 * Espejo SQL de `nombreClienteDisplay`, con la MISMA prioridad. Para endpoints que resuelven
 * el nombre dentro de la query (JOIN a clientes). Mantener sincronizado con la versión TS.
 *
 * @param alias alias de la tabla clientes en la query (ej. "cl", "c"). Solo [A-Za-z0-9_].
 * @returns expresión SQL que produce el nombre para mostrar (nunca NULL: cae a 'Cliente').
 *
 * Uso:
 *   `SELECT ${clienteDisplayNameSql("cl")} AS cliente_nombre FROM ... LEFT JOIN clientes cl ...`
 */
export function clienteDisplayNameSql(alias: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
    throw new Error(`clienteDisplayNameSql: alias inválido "${alias}"`);
  }
  const a = alias;
  const empresa = `NULLIF(btrim(${a}.empresa),'')`;
  const contacto = `COALESCE(NULLIF(btrim(${a}.nombre_contacto),''), NULLIF(btrim(${a}.nombre),''))`;
  const razon = `NULLIF(btrim(${a}.razon_social),'')`;
  return (
    `CASE WHEN lower(coalesce(${a}.tipo_cliente,'')) = 'persona' ` +
    `THEN COALESCE(${contacto}, ${empresa}, ${razon}, 'Cliente') ` +
    `ELSE COALESCE(${empresa}, ${contacto}, ${razon}, 'Cliente') END`
  );
}
