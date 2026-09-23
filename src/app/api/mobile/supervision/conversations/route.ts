import { NextResponse } from "next/server";
import { conBearer } from "@/lib/auth/bearer-contexto";
import { extractBearerTokenFromRequest } from "@/lib/auth/get-auth-user-for-api-route";
import { fetchChatChannels, fetchChatConversations } from "@/lib/chat/actions";
import { listChatQueues } from "@/lib/chat/chat-ops-actions";
import { requireEmpresaTenantServiceRole } from "@/lib/chat/empresa-tenant-service-role";

export const runtime = "nodejs";

/**
 * GET /api/mobile/supervision/conversations
 *
 * Las conversaciones que el usuario ve en el inbox del ESCRITORIO, para la app nativa.
 *
 * Existe para quien trabaja chats sin ser asesor de chat (sin `chat_agents`): la ruta de
 * asesor (`/api/mobile/asesor/conversations`) lista SOLO lo asignado a su agente, así que para
 * esa persona sale vacía aunque en la compu vea y atienda conversaciones.
 *
 * No abre nada nuevo: `fetchChatConversations` aplica por dentro el mismo alcance omnicanal
 * que el inbox de escritorio (admin ve todo, supervisor sus colas, agente lo suyo). Cada uno ve
 * exactamente lo que ya ve en la compu. Abrir y mandar después van por las rutas del escritorio,
 * que validan ese mismo alcance por conversación.
 *
 * Es una ruta NUEVA a propósito: la de asesor queda idéntica, así que no cambia nada para los
 * asesores que usan la app hoy.
 */
export async function GET(request: Request) {
  return conBearer(extractBearerTokenFromRequest(request), async () => {
    try {
      await requireEmpresaTenantServiceRole();
    } catch {
      return NextResponse.json(
        { ok: false, error: "Iniciá sesión", code: "unauthenticated" },
        { status: 401 }
      );
    }

    try {
      const sp = new URL(request.url).searchParams;
      const cola = sp.get("cola")?.trim() || null;
      // `?canal=`: el selector "Todos los canales" del inbox de escritorio (línea de WhatsApp,
      // Messenger, Instagram…).
      const canal = sp.get("canal")?.trim() || null;
      const [{ conversations }, queues, channels] = await Promise.all([
        fetchChatConversations("inbox", {
          assignment: "all",
          queue_id: cola,
          channel_id: canal,
          limit: 200,
        }),
        // Si las colas fallan, la lista igual sale: el selector simplemente no aparece.
        listChatQueues().catch(() => []),
        fetchChatChannels().catch(() => []),
      ]);
      return NextResponse.json({
        ok: true,
        queues: queues.filter((q) => q.is_active).map((q) => ({ id: q.id, nombre: q.nombre })),
        channels: channels
          .filter((c) => c.activo)
          .map((c) => ({ id: c.id, nombre: (c.nombre ?? "").trim() || "Canal", tipo: c.type ?? null })),
        conversations: conversations.map((c) => ({
          id: c.id,
          status: c.status,
          last_message_at: c.last_message_at,
          last_message_preview: c.last_message_preview,
          unread_count: c.unread_count,
          contact_nombre: c.contact?.name ?? null,
          contact_telefono: c.contact?.phone_number ?? null,
          queue_id: c.queue_id ?? null,
          last_message_from_me: c.last_message_from_me ?? null,
        })),
      });
    } catch (e) {
      console.error("[mobile/supervision/conversations]", e instanceof Error ? e.message : String(e));
      return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
    }
  });
}
