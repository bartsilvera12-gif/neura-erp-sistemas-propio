import { NextRequest, NextResponse } from "next/server";
import { requireEmpresaTenantServiceRole } from "@/lib/chat/empresa-tenant-service-role";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { getFcmMessaging } from "@/lib/cc/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/diag/push-prueba — manda UNA notificación de prueba a los celulares del usuario
 * logueado y devuelve, token por token, qué contestó Firebase.
 *
 * Existe porque cuando un push no llega, el error real (APNs sin clave, token viejo, app
 * borrada) solo lo dice Firebase al enviar, y en los logs del server no se veía por token.
 * Solo se manda al PROPIO usuario: no se puede notificar a nadie más desde acá.
 */
export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireEmpresaTenantServiceRole(request);
  } catch {
    return NextResponse.json({ ok: false, error: "Iniciá sesión" }, { status: 401 });
  }
  const { empresa_id, usuario_id } = ctx;

  const fcm = await getFcmMessaging();
  if (!fcm.ok) {
    return NextResponse.json({ ok: false, error: "firebase_no_configurado", detalle: fcm.reason });
  }

  const sb = createServiceRoleClient();
  const { data } = await sb
    .from("agent_device_tokens")
    .select("id, platform, fcm_token, updated_at")
    .eq("empresa_id", empresa_id)
    .eq("user_id", usuario_id)
    .eq("is_active", true);

  const filas = (data ?? []) as { id: string; platform: string; fcm_token: string; updated_at: string }[];
  if (filas.length === 0) {
    return NextResponse.json({ ok: true, enviados: 0, hint: "Este usuario no tiene celulares registrados." });
  }

  const resultados = [];
  for (const f of filas) {
    try {
      const id = await fcm.messaging.send({
        token: f.fcm_token,
        notification: { title: "Prueba de Zentra", body: "Si ves esto, las notificaciones funcionan." },
        data: { ruta: "/m/asesor", tipo: "prueba" },
        android: { priority: "high", notification: { channelId: "neura_inbox", sound: "noti" } },
        apns: { payload: { aps: { sound: "default" } } },
      });
      resultados.push({ token: f.id.slice(0, 8), platform: f.platform, ok: true, message_id: id.slice(-12) });
    } catch (e) {
      const err = e as { code?: string; message?: string; errorInfo?: { code?: string; message?: string } };
      resultados.push({
        token: f.id.slice(0, 8),
        platform: f.platform,
        ok: false,
        // El código y el mensaje de Firebase son los que dicen qué falta.
        code: err.errorInfo?.code ?? err.code ?? null,
        error: (err.errorInfo?.message ?? err.message ?? "").slice(0, 300),
        actualizado: f.updated_at,
      });
    }
  }

  return NextResponse.json({ ok: true, enviados: resultados.length, resultados });
}
