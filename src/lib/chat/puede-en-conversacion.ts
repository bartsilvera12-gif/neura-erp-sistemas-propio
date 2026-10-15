import "server-only";
import { filterConversationIdsByOmnicanalScope } from "@/lib/chat/omnicanal-scope";

type Cliente = Parameters<typeof filterConversationIdsByOmnicanalScope>[0];
type Catalogo = Parameters<typeof filterConversationIdsByOmnicanalScope>[1];

export type Veredicto = { ok: true } | { ok: false; status: number; error: string; code?: string };

/**
 * Quién puede actuar sobre una conversación desde la app móvil.
 *
 * Dos caminos, y el segundo es el que faltaba:
 *
 *  1. Tener la conversación asignada como agente.
 *  2. Verla por el alcance omnicanal — supervisión, PM, administración.
 *
 * Las rutas móviles exigían sólo el primero. Resultado: quien administra el
 * chat veía la conversación en la app, abría el teclado, escribía y recibía
 * "No autorizado para esta conversación", mientras en el ERP de escritorio
 * contestaba sin problema. La app terminaba siendo más restrictiva que la web
 * para la misma persona, sin que nada lo explicara.
 *
 * El criterio es exactamente el mismo helper con el que el inbox decide qué
 * mostrarle: si lo ve, puede contestarlo. No agrega permisos nuevos — alinea la
 * app con lo que el ERP ya decidió para esa persona.
 *
 * `transfer` ya lo hacía así desde que un supervisor no podía transferir.
 */
export async function puedeEnLaConversacion(args: {
  supabase: Cliente;
  catalogSr: Catalogo;
  empresaId: string;
  usuarioId: string;
  conversationId: string;
}): Promise<Veredicto> {
  const { supabase, catalogSr, empresaId, usuarioId, conversationId } = args;

  const { data: agRows } = await supabase
    .from("chat_agents")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("usuario_id", usuarioId);
  const mios = new Set((agRows ?? []).map((r) => String((r as { id: string }).id)));

  const { data: conv } = await supabase
    .from("chat_conversations")
    .select("assigned_agent_id")
    .eq("id", conversationId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!conv) return { ok: false, status: 404, error: "Conversación no encontrada" };

  const asignado = (conv as { assigned_agent_id: string | null }).assigned_agent_id;
  if (asignado && mios.has(String(asignado))) return { ok: true };

  const visibles = await filterConversationIdsByOmnicanalScope(
    supabase,
    catalogSr,
    empresaId,
    usuarioId,
    [conversationId],
  );
  if (visibles.has(conversationId)) return { ok: true };

  return {
    ok: false,
    status: 403,
    error: "No autorizado para esta conversación",
    code: "forbidden",
  };
}
