import { NextResponse } from "next/server";
import { conBearer } from "@/lib/auth/bearer-contexto";
import { extractBearerTokenFromRequest } from "@/lib/auth/get-auth-user-for-api-route";
import { fetchChatConversations } from "@/lib/chat/actions";
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
      const { conversations } = await fetchChatConversations("inbox", {
        assignment: "all",
        limit: 200,
      });
      return NextResponse.json({
        ok: true,
        conversations: conversations.map((c) => ({
          id: c.id,
          status: c.status,
          last_message_at: c.last_message_at,
          last_message_preview: c.last_message_preview,
          unread_count: c.unread_count,
          contact_nombre: c.contact?.name ?? null,
          contact_telefono: c.contact?.phone_number ?? null,
        })),
      });
    } catch (e) {
      console.error("[mobile/supervision/conversations]", e instanceof Error ? e.message : String(e));
      return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
    }
  });
}
