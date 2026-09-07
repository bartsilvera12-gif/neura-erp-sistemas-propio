/**
 * Módulos de acceso EXPLÍCITO.
 *
 * El resto del ERP funciona al revés: un `administrador` ve todos los módulos
 * habilitados para su empresa, y quien no tiene filas en `usuario_modulos` ve
 * todo por retrocompatibilidad. Para la mayoría de los módulos eso está bien.
 *
 * Estos no: sólo los ve quien tenga una fila explícita en `usuario_modulos`,
 * sin importar el rol. Es la única forma de que un tablero reservado no se
 * abra solo para los otros administradores de la empresa.
 *
 * Sigue siendo administrable —se agrega o se quita una fila— y no hay ningún
 * nombre de persona escrito en el código.
 */
export const MODULOS_RESTRINGIDOS = new Set(["tableros"]);

export function esModuloRestringido(slug: string | null | undefined): boolean {
  return MODULOS_RESTRINGIDOS.has((slug ?? "").trim().toLowerCase());
}
