import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { TICKET_CAMPOS, type TicketFila } from "@/lib/soporte/dominio";

/**
 * Consulta de PostgREST ya filtrable (después de `.select()`). Se tipa suelto a
 * propósito: los tipos genéricos de supabase-js cambian con cada columna del
 * select y no aportan nada a una función que sólo agrega `.eq()` y `.gte()`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ConsultaFiltrable = any;

/**
 * Todos los tickets de la empresa que cumplen un filtro, sin paginar.
 *
 * Para tableros y reportes, que agregan en memoria. El volumen de soporte de una
 * empresa (cientos, pocos miles de tickets) lo permite, y agregar en JS deja las
 * reglas de SLA en un solo lugar —`calcularSla`— en vez de repetirlas en SQL.
 * Se pagina de a 1000 porque PostgREST corta ahí.
 */
export async function ticketsParaAgregar(
  sb: AppSupabaseClient,
  empresaId: string,
  filtro?: (q: ConsultaFiltrable) => ConsultaFiltrable
): Promise<TicketFila[]> {
  const todos: TicketFila[] = [];
  for (let desde = 0; desde < 50_000; desde += 1000) {
    let q = sb.from("soporte_tickets").select(TICKET_CAMPOS).eq("empresa_id", empresaId);
    if (filtro) q = filtro(q);
    const { data, error } = await q.order("created_at", { ascending: true }).range(desde, desde + 999);
    if (error) throw new Error(error.message);
    const lote = (data ?? []) as TicketFila[];
    todos.push(...lote);
    if (lote.length < 1000) break;
  }
  return todos;
}
