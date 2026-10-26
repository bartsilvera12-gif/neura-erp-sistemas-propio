import { NextRequest, NextResponse } from "next/server";
import { POST as enviarReaccion } from "@/app/api/chat/react/route";
import { mensajeDeSesion, requireEmpresaTenantServiceRole } from "@/lib/chat/empresa-tenant-service-role";
import { puedeEnLaConversacion } from "@/lib/chat/puede-en-conversacion";

export const runtime = "nodejs";

/**
 * POST /api/mobile/asesor/conversations/[conversationId]/react
 * Body JSON: { target_wa_message_id, emoji }. Mismo patrón que send / send-media del móvil:
 *  1) verifica que la conversación esté asignada a un chat_agent del asesor logueado;
 *  2) delega en /api/chat/react, reenviando la auth del request.
 *
 * `emoji: ""` es válido: así se RETIRA una reacción puesta antes.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const { conversationId } = await params;
  let ctx;
  try {
    ctx = await requireEmpresaTenantServiceRole(request);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: mensajeDeSesion(e), code: "unauthenticated" },
      { status: 401 }
    );
  }
  const { supabase, catalogSr, empresa_id, usuario_id } = ctx;

  const body = (await request.json().catch(() => null)) as { target_wa_message_id?: string; emoji?: string } | null;
  const target = typeof body?.target_wa_message_id === "string" ? body.target_wa_message_id.trim() : "";
  const emoji = typeof body?.emoji === "string" ? body.emoji.trim() : "";
  if (!target) {
    return NextResponse.json({ ok: false, error: "Se requiere target_wa_message_id" }, { status: 400 });
  }

  // Puede quien la tiene asignada, y quien la ve por su alcance omnicanal
  // (supervisión, PM, administración). Exigir sólo lo primero dejaba a quien
  // administra el chat mirando la conversación en la app sin poder contestar,
  // mientras en el escritorio contestaba sin problema.
  try {
    const veredicto = await puedeEnLaConversacion({
      supabase,
      catalogSr,
      empresaId: empresa_id,
      usuarioId: usuario_id,
      conversationId,
    });
    if (!veredicto.ok) {
      return NextResponse.json(
        { ok: false, error: veredicto.error, ...(veredicto.code ? { code: veredicto.code } : {}) },
        { status: veredicto.status }
      );
    }
  } catch (e) {
    console.error("[mobile react] permiso", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }

  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const auth = request.headers.get("authorization");
    const cookie = request.headers.get("cookie");
    if (auth) headers.authorization = auth;
    if (cookie) headers.cookie = cookie;

    const res = await enviarReaccion(
      new NextRequest(new URL("/api/chat/react", request.url), {
        method: "POST",
        headers,
        body: JSON.stringify({ conversation_id: conversationId, target_wa_message_id: target, emoji }),
      })
    );
    const data = await res.json().catch(() => ({ ok: false, error: "react_failed" }));
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    console.error("[mobile react] forward", e instanceof Error ? e.message : String(e));
    const detalle = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: `No se pudo reaccionar: ${detalle.slice(0, 120)}` },
      { status: 502 }
    );
  }
}
