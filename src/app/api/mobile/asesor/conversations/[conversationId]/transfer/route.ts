import { NextRequest, NextResponse } from "next/server";
import { conBearer } from "@/lib/auth/bearer-contexto";
import { extractBearerTokenFromRequest } from "@/lib/auth/get-auth-user-for-api-route";
import {
  assignConversationToAgent,
  changeConversationQueue,
  fetchTransferTargetAgents,
  listTransferQueues,
} from "@/lib/chat/chat-ops-actions";
import { requireEmpresaTenantServiceRole } from "@/lib/chat/empresa-tenant-service-role";

export const runtime = "nodejs";

/**
 * Transferir una conversación, para clientes que NO son el navegador.
 *
 * La app web hace esto con server actions (`"use server"`), que no son HTTP: son un
 * protocolo interno entre el cliente de Next y su servidor. Una app nativa no puede
 * invocarlas. Esta ruta las expone por REST sin duplicar nada de su lógica — el reparto, los
 * eventos de routing y los avisos siguen saliendo del mismo lugar que en la web.
 *
 * Todo corre dentro de `conBearer` porque esas acciones resuelven al usuario por su cuenta
 * leyendo cookies, y desde la app no hay ninguna.
 *
 * GET  → { queues, agents }   las colas y los agentes a los que se puede transferir
 * POST → { queue_id } | { agent_id }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const { conversationId } = await params;
  return conBearer(extractBearerTokenFromRequest(request), async () => {
    const error = await verificarPertenencia(conversationId);
    if (error) return error;

    // Si una de las dos falla no se cae la pantalla entera: se muestra lo que haya.
    const [queues, agents] = await Promise.all([
      listTransferQueues().catch(() => []),
      fetchTransferTargetAgents().catch(() => []),
    ]);
    return NextResponse.json({ ok: true, queues, agents });
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const { conversationId } = await params;
  const body = (await request.json().catch(() => null)) as
    | { queue_id?: string; agent_id?: string }
    | null;
  const queueId = typeof body?.queue_id === "string" ? body.queue_id.trim() : "";
  const agentId = typeof body?.agent_id === "string" ? body.agent_id.trim() : "";
  if (!queueId && !agentId) {
    return NextResponse.json(
      { ok: false, error: "Se requiere queue_id o agent_id" },
      { status: 400 }
    );
  }

  return conBearer(extractBearerTokenFromRequest(request), async () => {
    const error = await verificarPertenencia(conversationId);
    if (error) return error;
    try {
      // A un agente concreto manda la acción de asignar; a una cola, la de cambiar de cola.
      if (agentId) await assignConversationToAgent(conversationId, agentId);
      else await changeConversationQueue(conversationId, queueId);
      return NextResponse.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No se pudo transferir";
      return NextResponse.json({ ok: false, error: msg }, { status: 400 });
    }
  });
}

/** Mismo criterio que el resto de las rutas móviles: solo sobre lo que tenés asignado. */
async function verificarPertenencia(conversationId: string): Promise<NextResponse | null> {
  let ctx;
  try {
    ctx = await requireEmpresaTenantServiceRole();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Iniciá sesión", code: "unauthenticated" },
      { status: 401 }
    );
  }
  const { supabase, empresa_id, usuario_id } = ctx;

  const { data: agRows } = await supabase
    .from("chat_agents")
    .select("id")
    .eq("empresa_id", empresa_id)
    .eq("usuario_id", usuario_id);
  const agentIds = new Set((agRows ?? []).map((r) => String((r as { id: string }).id)));

  const { data: conv } = await supabase
    .from("chat_conversations")
    .select("assigned_agent_id")
    .eq("id", conversationId)
    .eq("empresa_id", empresa_id)
    .maybeSingle();

  if (!conv) {
    return NextResponse.json({ ok: false, error: "Conversación no encontrada" }, { status: 404 });
  }
  const asignado = (conv as { assigned_agent_id: string | null }).assigned_agent_id;
  if (!asignado || !agentIds.has(String(asignado))) {
    return NextResponse.json(
      { ok: false, error: "No autorizado para esta conversación", code: "forbidden" },
      { status: 403 }
    );
  }
  return null;
}
