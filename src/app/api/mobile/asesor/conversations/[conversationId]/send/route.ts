import { NextRequest, NextResponse } from "next/server";
import { POST as enviarTexto } from "@/app/api/chat/send/route";
import { requireEmpresaTenantServiceRole } from "@/lib/chat/empresa-tenant-service-role";
import { puedeEnLaConversacion } from "@/lib/chat/puede-en-conversacion";

export const runtime = "nodejs";

/**
 * POST /api/mobile/asesor/conversations/[conversationId]/send
 * Wrapper SEGURO de envío para el asesor móvil:
 *  1) Verifica en backend (PostgREST) que la conversación esté asignada al asesor
 *     logueado (403 si no). Antes la verificación usaba el pool PG crudo → "Error interno".
 *  2) Delega en /api/chat/send (que valida empresa, ventana WhatsApp 24h y persiste +
 *     marca last_agent_message_at), reenviando la auth del request.
 * Body: { message }
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

  const body = (await request.json().catch(() => null)) as
    | { message?: string; reply_to_wamid?: string; reply_context?: Record<string, unknown> }
    | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return NextResponse.json({ ok: false, error: "message requerido" }, { status: 400 });
  // Cita opcional: wamid del mensaje al que se responde. /api/chat/send lo valida y,
  // si no es válido, envía igual sin cita — mejor eso que perder el mensaje.
  const replyToWamid =
    typeof body?.reply_to_wamid === "string" ? body.reply_to_wamid.trim() : "";
  // Snapshot del mensaje citado. Va al raw_payload para poder renderizar la cita en
  // nuestra propia UI; el desktop hace exactamente lo mismo.
  const replyContext =
    body?.reply_context && typeof body.reply_context === "object" ? body.reply_context : null;

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
    console.error("[mobile send] permiso", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }

  // 2) Delegar en /api/chat/send (ventana 24h + persistencia + markers), reenviando auth.
  const headers: Record<string, string> = { "content-type": "application/json" };
  const auth = request.headers.get("authorization");
  const cookie = request.headers.get("cookie");
  if (auth) headers.authorization = auth;
  if (cookie) headers.cookie = cookie;
  try {
    const res = await enviarTexto(
      new NextRequest(new URL("/api/chat/send", request.url), {
        method: "POST",
        headers,
        body: JSON.stringify({
        conversation_id: conversationId,
        message,
        ...(replyToWamid ? { reply_to_wamid: replyToWamid } : {}),
        ...(replyContext ? { reply_context: replyContext } : {}),
        }),
      })
    );
    const data = await res.json().catch(() => ({ ok: false, error: "send_failed" }));
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    console.error("[mobile send] forward", e instanceof Error ? e.message : String(e));
    const detalle = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: `No se pudo enviar: ${detalle.slice(0, 120)}` },
      { status: 502 }
    );
  }
}
