import "server-only";
import type { SupabaseAdmin } from "@/lib/chat/types";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { filterConversationIdsByOmnicanalScope } from "@/lib/chat/omnicanal-scope";
import { avisarPorPush } from "@/lib/cc/push-usuarios";

/**
 * Push de un mensaje entrante a quien mira los chats SIN ser asesor: supervisión, PM, admin.
 *
 * La cola del Contact Center (`agent_notification_events`) va por `agent_id`, así que a esa
 * gente nunca le llegaba nada aunque en el inbox vea la conversación.
 *
 * Solo se consulta a los usuarios que tienen la app instalada (fila activa en
 * `agent_device_tokens`), que son pocos, y a cada uno se le manda únicamente si la
 * conversación entra en su alcance omnicanal: el mismo criterio que decide qué ve en el
 * inbox. Al asesor asignado no se le manda acá — ese ya tiene su propio push.
 */
export async function avisarSupervisionPorPush(args: {
  supabase: SupabaseAdmin;
  empresaId: string;
  conversationId: string;
  assignedAgentId: string | null;
  preview: string;
}): Promise<void> {
  try {
    const catalogSr = createServiceRoleClient();

    const { data: filas } = await catalogSr
      .from("agent_device_tokens")
      .select("user_id")
      .eq("empresa_id", args.empresaId)
      .eq("is_active", true);
    const usuarios = [...new Set(((filas ?? []) as { user_id: string }[]).map((f) => f.user_id).filter(Boolean))];
    if (usuarios.length === 0) return;

    // El asesor asignado ya recibe el push del Contact Center: no se le manda dos veces.
    let usuarioDelAgente: string | null = null;
    if (args.assignedAgentId) {
      const { data: ag } = await args.supabase
        .from("chat_agents")
        .select("usuario_id")
        .eq("empresa_id", args.empresaId)
        .eq("id", args.assignedAgentId)
        .maybeSingle();
      usuarioDelAgente = (ag as { usuario_id?: string } | null)?.usuario_id ?? null;
    }

    const destinatarios: string[] = [];
    for (const usuarioId of usuarios) {
      if (usuarioId === usuarioDelAgente) continue;
      try {
        const visibles = await filterConversationIdsByOmnicanalScope(
          args.supabase,
          catalogSr,
          args.empresaId,
          usuarioId,
          [args.conversationId]
        );
        if (visibles.has(args.conversationId)) destinatarios.push(usuarioId);
      } catch {
        // Si el alcance no se puede resolver, NO se manda: mejor perder un push que
        // mostrarle a alguien un chat que no le corresponde.
      }
    }
    if (destinatarios.length === 0) return;

    const { data: conv } = await args.supabase
      .from("chat_conversations")
      .select("contact_id")
      .eq("id", args.conversationId)
      .eq("empresa_id", args.empresaId)
      .maybeSingle();
    let quien = "";
    const contactId = (conv as { contact_id?: string | null } | null)?.contact_id ?? null;
    if (contactId) {
      const { data: ct } = await args.supabase
        .from("chat_contacts")
        .select("name, phone_number")
        .eq("id", contactId)
        .eq("empresa_id", args.empresaId)
        .maybeSingle();
      const c = ct as { name?: string | null; phone_number?: string | null } | null;
      quien = (c?.name || c?.phone_number || "").toString().trim();
    }

    await avisarPorPush({
      empresaId: args.empresaId,
      usuarioIds: destinatarios,
      titulo: quien || "Nuevo mensaje",
      cuerpo: args.preview || "Nuevo mensaje",
      ruta: `/m/asesor/chat/${args.conversationId}`,
      agrupar: `chat-${args.conversationId}`,
    });
  } catch (e) {
    console.warn("[push-supervision]", e instanceof Error ? e.message : String(e));
  }
}
