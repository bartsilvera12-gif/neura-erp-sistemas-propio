import { NextRequest, NextResponse } from "next/server";
import { POST as enviarSticker } from "@/app/api/chat/send-sticker/route";
import { requireEmpresaTenantServiceRole } from "@/lib/chat/empresa-tenant-service-role";
import { puedeEnLaConversacion } from "@/lib/chat/puede-en-conversacion";

export const runtime = "nodejs";

/**
 * POST /api/mobile/asesor/conversations/[conversationId]/send-sticker
 * Body JSON: { sticker_url }. Mismo patrón que send / send-media del móvil:
 *  1) verifica que la conversación esté asignada a un chat_agent del asesor logueado;
 *  2) delega en /api/chat/send-sticker, reenviando la auth del request.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const { conversationId } = await params;
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

  const body = (await request.json().catch(() => null)) as { sticker_url?: string } | null;
  const stickerUrl = typeof body?.sticker_url === "string" ? body.sticker_url.trim() : "";
  if (!stickerUrl) {
    return NextResponse.json({ ok: false, error: "Se requiere sticker_url" }, { status: 400 });
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
    console.error("[mobile send-sticker] permiso", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }

  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const auth = request.headers.get("authorization");
    const cookie = request.headers.get("cookie");
    if (auth) headers.authorization = auth;
    if (cookie) headers.cookie = cookie;

    const res = await enviarSticker(
      new NextRequest(new URL("/api/chat/send-sticker", request.url), {
        method: "POST",
        headers,
        body: JSON.stringify({ conversation_id: conversationId, sticker_url: stickerUrl }),
      })
    );
    const data = await res.json().catch(() => ({ ok: false, error: "send_sticker_failed" }));
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    console.error("[mobile send-sticker] forward", e instanceof Error ? e.message : String(e));
    const detalle = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: `No se pudo enviar el sticker: ${detalle.slice(0, 120)}` },
      { status: 502 }
    );
  }
}
