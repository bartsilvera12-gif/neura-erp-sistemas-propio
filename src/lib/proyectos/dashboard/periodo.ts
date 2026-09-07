/**
 * Qué entra en el período elegido por el usuario.
 *
 * Módulo ISOMÓRFICO a propósito (sin `server-only`): la API filtra con esta
 * regla y el script de pruebas la verifica. Si viviera dentro del cargador de
 * datos no se podría probar sin levantar medio Next.
 */

/**
 * ¿El proyecto entra en el período elegido?
 *
 * El recorte NO es por fecha de ingreso. Lo era, y daba dos lecturas
 * equivocadas a la vez: "Carga del equipo" mostraba un solo técnico (los demás
 * tenían proyectos entrados meses atrás) y "Entregado" contaba lo ingresado en
 * el mes que hoy está entregado, en vez de lo entregado en el mes.
 *
 * La regla es una sola y sale de qué mide cada cosa:
 *
 *   · El trabajo VIVO entra siempre. Un proyecto abierto es el estado de hoy;
 *     recortarlo por cuándo entró sería esconder trabajo que existe.
 *   · Lo CERRADO entra si se cerró dentro del período. Para un entregado, la
 *     fecha que importa es la de entrega.
 *
 * Así "desde el 1 del mes" se lee como uno espera: todo lo que está en curso,
 * más lo que se entregó este mes.
 */
export function enPeriodo(
  p: { entregado: boolean; cancelado: boolean; fecha_entrega: string | null },
  desde: string | null,
  hasta: string | null
): boolean {
  if (!desde && !hasta) return true;
  if (!p.entregado && !p.cancelado) return true;
  const ms = p.fecha_entrega ? Date.parse(p.fecha_entrega) : Number.NaN;
  // Cerrado sin fecha de cierre: no se puede ubicar en el tiempo y no se le
  // inventa una. Queda fuera del período — mejor que falte a que mienta.
  if (!Number.isFinite(ms)) return false;
  if (desde && ms < Date.parse(`${desde}T00:00:00`)) return false;
  if (hasta && ms > Date.parse(`${hasta}T23:59:59`)) return false;
  return true;
}
