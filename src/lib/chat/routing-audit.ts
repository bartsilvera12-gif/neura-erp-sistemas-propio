import type { SupabaseAdmin } from "@/lib/chat/types";

export type ChatRoutingEventType =
  /** La conversación cambió de cola (p. ej. la pasaron a project manager). */
  | "queue_changed"
  | "assigned_auto"
  | "manual_queue_only"
  | "no_queue"
  | "no_eligible_agent"
  | "same_advisor_route"
  | "reassigned_initial_timeout"
  | "reassign_skipped_no_alternate"
  | "reassign_skipped_max_iterations"
  | "supervisor_assigned";

/**
 * Datos del evento. Además de lo propio de cada tipo, los eventos de asignación y de cambio
 * de cola llevan el rastro de QUIÉN y DESDE DÓNDE, que es lo que permite reconstruir después
 * la línea de tiempo del contacto ("lo tomó Fulano, lo transfirió Mengano a la cola X"):
 *
 *  - `by_usuario_id`: usuario que ejecutó la acción (null si la hizo el sistema).
 *  - `from_agent_id` / `from_queue_id`: dónde estaba la conversación antes.
 *  - `to_agent_id` / `to_queue_id`: dónde quedó.
 *
 * Es `jsonb` libre, así que agregar claves no rompe nada ya guardado.
 */
export type RoutingEventPayload = Record<string, unknown>;

export async function insertChatRoutingEvent(
  supabase: SupabaseAdmin,
  input: {
    empresa_id: string;
    conversation_id: string;
    queue_id: string | null;
    event_type: ChatRoutingEventType;
    payload?: RoutingEventPayload;
  }
): Promise<void> {
  const { error } = await supabase.from("chat_routing_events").insert({
    empresa_id: input.empresa_id,
    conversation_id: input.conversation_id,
    queue_id: input.queue_id,
    event_type: input.event_type,
    payload: input.payload ?? {},
  });
  if (error) {
    console.warn("[routing-audit] insertChatRoutingEvent", error.message);
  }
}

/** Actualiza preferencia de “mismo asesor”: ancla = última asignación efectiva a un chat_agents.id en este canal. */
export async function updateContactLastRouted(
  supabase: SupabaseAdmin,
  input: {
    empresa_id: string;
    contact_id: string;
    channel_id: string;
    chat_agent_id: string;
    at_iso: string;
  }
): Promise<void> {
  const { error } = await supabase
    .from("chat_contacts")
    .update({
      last_routed_chat_agent_id: input.chat_agent_id,
      last_routed_at: input.at_iso,
      last_routed_channel_id: input.channel_id,
      updated_at: input.at_iso,
    })
    .eq("id", input.contact_id)
    .eq("empresa_id", input.empresa_id);
  if (error) {
    console.warn("[routing-audit] updateContactLastRouted", error.message);
  }
}
