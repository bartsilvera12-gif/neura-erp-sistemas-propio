/**
 * Autenticar el socket de Realtime antes de suscribirse.
 *
 * Las suscripciones `postgres_changes` sobre tablas con RLS se evalúan con el
 * token que tiene el socket en el momento de unirse al canal. `supabase-js` lo
 * pone solo cuando cambia el estado de la sesión — pero al entrar a una
 * pantalla la sesión ya venía restaurada de la cookie, no cambia nada, y el
 * canal se une con el token anónimo. RLS entonces no deja pasar NADA, la
 * suscripción dice "SUBSCRIBED" y no llega un solo evento.
 *
 * Es exactamente lo que estaba pasando: ni la campanita ni el chat se
 * actualizaban solos, y no había ningún error a la vista.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export async function autenticarRealtime(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: SupabaseClient<any, any, any>
): Promise<boolean> {
  try {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return false;
    sb.realtime.setAuth(token);
    return true;
  } catch {
    return false;
  }
}
