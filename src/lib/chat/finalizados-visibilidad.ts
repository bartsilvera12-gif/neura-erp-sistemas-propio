import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { isOmnicanalAdminScope, type OmnicanalScope } from "@/lib/chat/omnicanal-scope";

/**
 * Visibilidad extra en Conversaciones finalizadas.
 *
 * Un asesor ve solo sus cierres. `chat_finalizados_visibilidad` le suma los de
 * otros usuarios puntuales (p. ej. una PM que revisa lo que cerraron los
 * comerciales). SOLO aplica a finalizadas: no toca el rol omnicanal, ni el inbox
 * en vivo, ni lo que se puede responder o tomar.
 *
 * Nunca lanza: si la tabla falta (schema sin migrar) o hay error, el alcance
 * queda exactamente como antes.
 */
export async function usuariosVisiblesEnFinalizados(
  supabase: AppSupabaseClient,
  empresaId: string,
  usuarioId: string
): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from("chat_finalizados_visibilidad")
      .select("ver_usuario_id")
      .eq("empresa_id", empresaId)
      .eq("usuario_id", usuarioId);
    if (error) return [];
    return [
      ...new Set(
        ((data ?? []) as { ver_usuario_id?: unknown }[])
          .map((r) => String(r.ver_usuario_id ?? "").trim())
          .filter((x) => x && x !== usuarioId)
      ),
    ];
  } catch {
    return [];
  }
}

/**
 * Alcance para Conversaciones finalizadas. Admin y supervisor quedan igual; a un
 * asesor con visibilidad extra se le da la vista de equipo (él + esos usuarios),
 * que es la que ya trae el selector de agente. Sin colas: solo lo asignado a
 * esas personas, nunca lo "sin asignar" de una cola.
 */
export async function alcanceFinalizados(
  supabase: AppSupabaseClient,
  empresaId: string,
  usuarioId: string,
  scope: OmnicanalScope
): Promise<OmnicanalScope> {
  if (isOmnicanalAdminScope(scope) || scope.role === "supervisor") return scope;
  const extra = await usuariosVisiblesEnFinalizados(supabase, empresaId, usuarioId);
  if (extra.length === 0) return scope;
  return { role: "supervisor", queueIds: [], agentUsuarioIds: [usuarioId, ...extra] };
}

/**
 * ¿Puede leer los mensajes de esta conversación por visibilidad de finalizadas?
 * Solo si está CERRADA y asignada a alguien de su lista.
 */
export async function puedeVerCierreAjeno(
  supabase: AppSupabaseClient,
  empresaId: string,
  usuarioId: string,
  conversationId: string
): Promise<boolean> {
  const extra = await usuariosVisiblesEnFinalizados(supabase, empresaId, usuarioId);
  if (extra.length === 0) return false;
  try {
    const { data: conv } = await supabase
      .from("chat_conversations")
      .select("status, assigned_agent_id")
      .eq("empresa_id", empresaId)
      .eq("id", conversationId)
      .maybeSingle();
    const c = conv as { status?: string | null; assigned_agent_id?: string | null } | null;
    if (!c || c.status !== "closed" || !c.assigned_agent_id) return false;
    const { data: agente } = await supabase
      .from("chat_agents")
      .select("usuario_id")
      .eq("empresa_id", empresaId)
      .eq("id", c.assigned_agent_id)
      .maybeSingle();
    const dueno = String((agente as { usuario_id?: unknown } | null)?.usuario_id ?? "");
    return extra.includes(dueno);
  } catch {
    return false;
  }
}
