import { NextRequest, NextResponse } from "next/server";
import { POST as enviarMedia } from "@/app/api/chat/send-media/route";
import { requireEmpresaTenantServiceRole } from "@/lib/chat/empresa-tenant-service-role";
import { puedeEnLaConversacion } from "@/lib/chat/puede-en-conversacion";

export const runtime = "nodejs";

/**
 * POST /api/mobile/asesor/conversations/[conversationId]/send-media
 * Envío de media (nota de voz) del asesor móvil. Mismo patrón seguro que el envío de texto:
 *  1) Verifica sesión + que la conversación esté asignada a un chat_agent del asesor logueado (403 si no).
 *  2) Reenvía el multipart a /api/chat/send-media (que sube a Storage `chat-media`, valida ventana 24h,
 *     persiste el mensaje `audio` y despacha a WhatsApp), reenviando la auth del request.
 * Body: FormData { file, caption? }. conversation_id se toma de la URL.
 * NO duplica lógica de media: reutiliza /api/chat/send-media.
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

  // Parseo del multipart entrante.
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size < 1) {
    return NextResponse.json({ ok: false, error: "Se requiere archivo de audio" }, { status: 400 });
  }
  const capRaw = form?.get("caption");
  const caption = typeof capRaw === "string" ? capRaw : "";

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
    console.error("[mobile send-media] permiso", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }

  // 2) Entregarlo a /api/chat/send-media (Storage + ventana 24h + persistencia + WhatsApp).
  //    Se llama al handler EN PROCESO (no por HTTP contra uno mismo): un salto de red acá
  //    fallaba sin dejar motivo y el asesor veía un 502 pelado al mandar una nota de voz.
  //    Se le pasa la auth/cookie del asesor; sin content-type, lo arma el FormData.
  try {
    const fwd = new FormData();
    fwd.set("conversation_id", conversationId);
    fwd.set("file", file, file.name || "nota-voz.webm");
    if (caption) fwd.set("caption", caption);

    const headers: Record<string, string> = {};
    const auth = request.headers.get("authorization");
    const cookie = request.headers.get("cookie");
    if (auth) headers.authorization = auth;
    if (cookie) headers.cookie = cookie;

    const res = await enviarMedia(
      new NextRequest(new URL("/api/chat/send-media", request.url), {
        method: "POST",
        headers,
        body: fwd,
      })
    );
    const data = await res.json().catch(() => ({ ok: false, error: "send_media_failed" }));
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    console.error("[mobile send-media] forward", e instanceof Error ? e.message : String(e));
    const detalle = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: `No se pudo enviar el audio: ${detalle.slice(0, 120)}` },
      { status: 502 }
    );
  }
}
