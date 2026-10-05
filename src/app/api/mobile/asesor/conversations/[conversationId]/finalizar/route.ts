import { NextRequest, NextResponse } from "next/server";
import { conBearer } from "@/lib/auth/bearer-contexto";
import { extractBearerTokenFromRequest } from "@/lib/auth/get-auth-user-for-api-route";
import {
  finalizeConversationWithClosure,
  loadFinalizeOptionsForConversation,
} from "@/lib/chat/conversation-finalize-actions";
import { requireEmpresaTenantServiceRole } from "@/lib/chat/empresa-tenant-service-role";
import { filterConversationIdsByOmnicanalScope } from "@/lib/chat/omnicanal-scope";

export const runtime = "nodejs";

/**
 * Finalizar una conversación con su tipificación, para clientes que NO son el navegador.
 *
 * La app web de escritorio hace esto con server actions (`"use server"`), que no son HTTP:
 * son un protocolo interno entre el cliente de Next y su servidor. Esta ruta las expone por
 * REST sin duplicar nada — las mismas opciones de cierre, las mismas validaciones y el mismo
 * registro en `chat_conversation_closures` que en el escritorio.
 *
 * Todo corre dentro de `conBearer` porque esas acciones resuelven al usuario por su cuenta
 * leyendo cookies, y desde la app envuelta en Capacitor no hay ninguna.
 *
 * GET  → { states }  estados y subestados de cierre de la cola de esta conversación
 * POST → { closure_state_id, closure_substate_id, closure_state_label,
 *          closure_substate_label, comment }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const { conversationId } = await params;
  return conBearer(extractBearerTokenFromRequest(request), async () => {
    const error = await verificarAcceso(conversationId);
    if (error) return error;
    try {
      const opciones = await loadFinalizeOptionsForConversation(conversationId);
      return NextResponse.json({ ok: true, ...opciones });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No se pudieron cargar las opciones de cierre";
      return NextResponse.json({ ok: false, error: msg }, { status: 400 });
    }
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const { conversationId } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const txt = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  const estadoId = txt(body?.closure_state_id);
  const comentario = txt(body?.comment);
  if (!estadoId) {
    return NextResponse.json({ ok: false, error: "Elegí un estado." }, { status: 400 });
  }
  // Mismo mínimo que el escritorio: un cierre sin comentario no le sirve a nadie después.
  if (comentario.length < 3) {
    return NextResponse.json(
      { ok: false, error: "El comentario es obligatorio (al menos 3 caracteres)." },
      { status: 400 }
    );
  }

  return conBearer(extractBearerTokenFromRequest(request), async () => {
    const error = await verificarAcceso(conversationId);
    if (error) return error;
    try {
      await finalizeConversationWithClosure({
        conversationId,
        closureStateId: estadoId,
        closureSubstateId: txt(body?.closure_substate_id) || null,
        closureStateLabel: txt(body?.closure_state_label),
        closureSubstateLabel: txt(body?.closure_substate_label) || "—",
        comment: comentario,
      });
      return NextResponse.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No se pudo finalizar la conversación";
      return NextResponse.json({ ok: false, error: msg }, { status: 400 });
    }
  });
}

/**
 * Puede cerrar quien la tiene asignada como agente, o quien la ve por su alcance omnicanal
 * (supervisión). Es el mismo criterio con el que la app le muestra el chat: si lo podés
 * atender, lo podés cerrar.
 */
async function verificarAcceso(conversationId: string): Promise<NextResponse | null> {
  let ctx;
  try {
    ctx = await requireEmpresaTenantServiceRole();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Iniciá sesión", code: "unauthenticated" },
      { status: 401 }
    );
  }
  const { supabase, catalogSr, empresa_id, usuario_id } = ctx;

  const { data: conv } = await supabase
    .from("chat_conversations")
    .select("assigned_agent_id, status")
    .eq("id", conversationId)
    .eq("empresa_id", empresa_id)
    .maybeSingle();
  if (!conv) {
    return NextResponse.json({ ok: false, error: "Conversación no encontrada" }, { status: 404 });
  }
  if (String((conv as { status: string }).status) === "closed") {
    return NextResponse.json(
      { ok: false, error: "La conversación ya está finalizada." },
      { status: 409 }
    );
  }

  const { data: agRows } = await supabase
    .from("chat_agents")
    .select("id")
    .eq("empresa_id", empresa_id)
    .eq("usuario_id", usuario_id);
  const mios = new Set((agRows ?? []).map((r) => String((r as { id: string }).id)));
  const asignado = (conv as { assigned_agent_id: string | null }).assigned_agent_id;
  if (asignado && mios.has(String(asignado))) return null;

  const visibles = await filterConversationIdsByOmnicanalScope(
    supabase,
    catalogSr,
    empresa_id,
    usuario_id,
    [conversationId]
  );
  if (visibles.has(conversationId)) return null;

  return NextResponse.json(
    { ok: false, error: "No autorizado para esta conversación", code: "forbidden" },
    { status: 403 }
  );
}
