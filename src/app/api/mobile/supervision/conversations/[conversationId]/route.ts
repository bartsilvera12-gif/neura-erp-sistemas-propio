import { NextRequest, NextResponse } from "next/server";
import { conBearer } from "@/lib/auth/bearer-contexto";
import { extractBearerTokenFromRequest } from "@/lib/auth/get-auth-user-for-api-route";
import { requireEmpresaTenantServiceRole } from "@/lib/chat/empresa-tenant-service-role";
import { filterConversationIdsByOmnicanalScope } from "@/lib/chat/omnicanal-scope";
import { puedeVerCierreAjeno } from "@/lib/chat/finalizados-visibilidad";
import { cargarConversacionMovil, detalleConversacionMovil } from "@/lib/chat/mobile-conversation-detail";

export const runtime = "nodejs";

/**
 * GET /api/mobile/supervision/conversations/[conversationId]
 * Mismo detalle que la ruta del asesor, para quien atiende chats sin ser agente (admin,
 * supervisor). La diferencia es la autorización: acá manda el alcance omnicanal, igual que
 * `/api/chat/messages` en el escritorio. A diferencia de esa ruta, si la validación falla
 * se niega el acceso en vez de dejar pasar.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const { conversationId } = await params;
  // Con el token en contexto, lo que por dentro resuelva al usuario por cookies también anda
  // desde la app nativa.
  return conBearer(extractBearerTokenFromRequest(request), () => manejar(request, conversationId));
}

async function manejar(request: NextRequest, conversationId: string) {
  let ctx;
  try {
    ctx = await requireEmpresaTenantServiceRole(request);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Iniciá sesión", code: "unauthenticated" },
      { status: 401 }
    );
  }
  const { supabase, catalogSr, empresa_id, usuario_id } = ctx;

  try {
    const conv = await cargarConversacionMovil(supabase, empresa_id, conversationId);
    if (!conv) {
      return NextResponse.json({ ok: false, error: "Conversación no encontrada" }, { status: 404 });
    }

    const visible = await filterConversationIdsByOmnicanalScope(
      supabase,
      catalogSr,
      empresa_id,
      usuario_id,
      [conversationId]
    );
    if (
      !visible.has(conversationId) &&
      !(await puedeVerCierreAjeno(supabase, empresa_id, usuario_id, conversationId))
    ) {
      return NextResponse.json(
        { ok: false, error: "No autorizado para esta conversación", code: "forbidden" },
        { status: 403 }
      );
    }

    return NextResponse.json(await detalleConversacionMovil(supabase, empresa_id, conversationId, conv));
  } catch (e) {
    console.error("[mobile/supervision/conversations/:id]", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}
