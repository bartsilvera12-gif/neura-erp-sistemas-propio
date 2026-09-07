import "server-only";

/**
 * El Project Manager de un proyecto SIGUE al de su cliente.
 *
 * La regla es una sola y no admite excepciones: si el proyecto tiene cliente,
 * su PM es el de la ficha de ese cliente. Tener un PM en el proyecto y otro
 * distinto en el cliente significa que dos personas creen ser responsables del
 * mismo trabajo, y el que llame primero al cliente lo va a descubrir tarde.
 *
 * `proyectos.project_manager_id` existe igual —no es redundante— por dos
 * razones: hay proyectos SIN ficha de cliente, que de otro modo no podrían
 * tener responsable, y guardar el valor evita resolver el cliente en cada
 * lectura del tablero.
 *
 * Este módulo es el único lugar donde se decide ese valor. Se llama desde las
 * cuatro puertas por las que puede desincronizarse:
 *
 *   1. al crear un proyecto,
 *   2. al cambiarle el cliente,
 *   3. al mover clientes de cartera desde Gestión de Project Managers,
 *   4. al editar el PM en la ficha del cliente.
 */

import type { AppSupabaseClient } from "@/lib/supabase/schema";

/** PM que le corresponde a un proyecto según su cliente. `null` si no tiene. */
export async function pmDelCliente(
  sb: AppSupabaseClient,
  empresaId: string,
  clienteId: string | null | undefined
): Promise<string | null> {
  if (!clienteId) return null;
  const { data } = await sb
    .from("clientes")
    .select("project_manager_id")
    .eq("empresa_id", empresaId)
    .eq("id", clienteId)
    .maybeSingle();
  const pm = (data as { project_manager_id?: string | null } | null)?.project_manager_id;
  return typeof pm === "string" && pm ? pm : null;
}

/**
 * Realinea los proyectos de esos clientes con el PM de su ficha.
 *
 * Nunca lanza: es una consecuencia de otra operación que ya se guardó, y no
 * puede hacer fallar el guardado del cliente por un problema propio.
 */
export async function sincronizarPmDeClientes(
  sb: AppSupabaseClient,
  empresaId: string,
  clienteIds: string[]
): Promise<number> {
  const ids = [...new Set(clienteIds.filter(Boolean))];
  if (ids.length === 0) return 0;
  try {
    const { data } = await sb
      .from("clientes")
      .select("id, project_manager_id")
      .eq("empresa_id", empresaId)
      .in("id", ids);

    const filas = (data ?? []) as { id: string; project_manager_id: string | null }[];
    let tocados = 0;
    for (const cl of filas) {
      const { error } = await sb
        .from("proyectos")
        .update({ project_manager_id: cl.project_manager_id ?? null })
        .eq("empresa_id", empresaId)
        .eq("cliente_id", cl.id)
        .eq("archivado", false);
      if (!error) tocados += 1;
    }
    return tocados;
  } catch {
    return 0;
  }
}
