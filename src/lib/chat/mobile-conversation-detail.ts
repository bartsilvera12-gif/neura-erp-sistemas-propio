import type { SupabaseClient } from "@supabase/supabase-js";

type ConvBase = {
  id: string;
  status: string;
  assigned_agent_id: string | null;
  whatsapp_window_expires_at: string | null;
  contact_id: string | null;
};

/** La conversación cruda, o null si no es de la empresa. La autorización la decide cada ruta. */
export async function cargarConversacionMovil(
  supabase: SupabaseClient,
  empresa_id: string,
  conversationId: string
): Promise<ConvBase | null> {
  const { data } = await supabase
    .from("chat_conversations")
    .select("id, status, assigned_agent_id, whatsapp_window_expires_at, contact_id")
    .eq("id", conversationId)
    .eq("empresa_id", empresa_id)
    .maybeSingle();
  return (data as ConvBase | null) ?? null;
}

/**
 * Detalle + mensajes recientes de una conversación YA AUTORIZADA, con la forma que usan la
 * app móvil web y la nativa. Compartido por la ruta del asesor (chat asignado a su agente)
 * y la de supervisión (alcance omnicanal), que difieren solo en quién puede abrirla.
 */
export async function detalleConversacionMovil(
  supabase: SupabaseClient,
  empresa_id: string,
  conversationId: string,
  conv: ConvBase
) {
  // Abrir el chat desde la app = marcarlo LEÍDO (baja el badge de no-leídos en la lista, como
  // WhatsApp). Antes esto solo pasaba al leer desde el escritorio, así que el numerito no se iba
  // al abrir desde el celular. Es idempotente y solo corre para una conversación ya autorizada.
  await supabase
    .from("chat_conversations")
    .update({ unread_count: 0, updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("empresa_id", empresa_id);

  const contactId = (conv as { contact_id: string | null }).contact_id;
  let contactNombre: string | null = null;
  let contactTelefono: string | null = null;
  if (contactId) {
    const { data: ct } = await supabase
      .from("chat_contacts")
      .select("name, phone_number")
      .eq("id", contactId)
      .eq("empresa_id", empresa_id)
      .maybeSingle();
    if (ct) {
      contactNombre = ((ct as { name: string | null }).name ?? "").toString().trim() || null;
      contactTelefono = ((ct as { phone_number: string | null }).phone_number ?? "").toString().trim() || null;
    }
  }

  const { data: msgRows } = await supabase
    .from("chat_messages")
    .select("id, wa_message_id, from_me, sender_type, content, message_type, created_at, raw_payload, whatsapp_delivery_status")
    .eq("conversation_id", conversationId)
    .eq("empresa_id", empresa_id)
    .order("created_at", { ascending: false })
    .limit(80);

  const messages = ((msgRows ?? []) as Array<Record<string, unknown>>)
    .map((m) => ({
      id: m.id as string,
      // ID del mensaje en WhatsApp. Necesario para citarlo al responder
      // (`reply_to_wamid` en /api/chat/send). Null en mensajes que nunca salieron.
      wa_message_id: (m.wa_message_id as string | null) ?? null,
      from_me: Boolean(m.from_me),
      sender_type: (m.sender_type as string | null) ?? null,
      content: (m.content as string | null) ?? "",
      message_type: (m.message_type as string | null) ?? "text",
      created_at: (m.created_at as string | null) ?? null,
      raw_payload: (m.raw_payload as Record<string, unknown> | null) ?? null,
      whatsapp_delivery_status: (m.whatsapp_delivery_status as string | null) ?? null,
    }))
    .reverse();

  const expiresAt = (conv as { whatsapp_window_expires_at: string | null }).whatsapp_window_expires_at;
  // YCloud coexistence: no señalamos "ventana cerrada" preventivamente (el ERP ya no
  // pre-bloquea envíos; si YCloud rechaza, se ve el error real). Reportamos `true` solo
  // como indicador positivo cuando está abierta; nunca `false` (así el composer mobile no
  // muestra el banner de "24 h cerrada"). `whatsapp_window_expires_at` queda informativo.
  const windowOpen = expiresAt && new Date(expiresAt).getTime() > Date.now() ? true : null;

  return {
    ok: true,
    conversation: {
      id: (conv as { id: string }).id,
      status: (conv as { status: string }).status,
      // Necesario para marcar "Asignado" al agente actual en el modal de transferir.
      assigned_agent_id: (conv as { assigned_agent_id: string | null }).assigned_agent_id ?? null,
      contact_nombre: contactNombre,
      contact_telefono: contactTelefono,
      window_open: windowOpen,
      whatsapp_window_expires_at: expiresAt,
    },
    messages,
  };
}
