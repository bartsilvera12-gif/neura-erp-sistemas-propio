import { NextRequest, NextResponse } from "next/server";
import { requireEmpresaTenantServiceRole } from "@/lib/chat/empresa-tenant-service-role";
import { firebaseConfigured, getFcmMessaging } from "@/lib/cc/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/_diag/push
 *
 * Diagnóstico end-to-end del push nativo del asesor. NO manda pushes.
 *
 * Del usuario logueado (cookies o Bearer) devuelve:
 *  - is_agent + agent_id                         (¿el usuario es asesor real?)
 *  - device_tokens (últimos 5)                   (¿registró el APK su token FCM?)
 *  - notification_events pending/sent/failed     (últimos 10)  (¿la cola avanza?)
 *  - firebase_configured                         (¿el server puede hablar con FCM?)
 *  - contact_center_v1_enabled                   (¿se crean eventos al recibir mensajes?)
 *
 * Sin auth devuelve solo flags globales de configuración. No expone tokens
 * completos ni secretos; los fcm_token vienen truncados.
 */
export async function GET(request: NextRequest) {
  const globalFlags = {
    firebase_configured: firebaseConfigured(),
    contact_center_v1_enabled: ["1", "true", "yes"].includes(
      (process.env.CONTACT_CENTER_V1 ?? "").trim().toLowerCase()
    ),
    cron_secret_set: Boolean(process.env.CRON_SECRET?.trim()),
  };

  let ctx;
  try {
    ctx = await requireEmpresaTenantServiceRole(request);
  } catch {
    return NextResponse.json({
      ok: true,
      authed: false,
      hint: "Iniciá sesión en el ERP para ver el estado de tu dispositivo.",
      global: globalFlags,
    });
  }

  const { supabase, empresa_id, usuario_id } = ctx;

  const truncar = (t: string | null | undefined) => {
    if (!t) return null;
    if (t.length <= 16) return t;
    return `${t.slice(0, 8)}…${t.slice(-6)} (len=${t.length})`;
  };

  const { data: agRows } = await supabase
    .from("chat_agents")
    .select("id, is_active")
    .eq("empresa_id", empresa_id)
    .eq("usuario_id", usuario_id)
    .order("is_active", { ascending: false })
    .limit(1);
  const agent = (agRows?.[0] as { id?: string; is_active?: boolean } | undefined) ?? null;
  const agentId = agent?.id ?? null;

  const { data: tks } = await supabase
    .from("agent_device_tokens")
    .select("id, agent_id, user_id, platform, is_active, last_seen_at, updated_at, app_version, fcm_token")
    .eq("empresa_id", empresa_id)
    .eq("user_id", usuario_id)
    .order("updated_at", { ascending: false })
    .limit(5);
  const tokens = (tks ?? []).map((r) => {
    const t = r as {
      id: string;
      agent_id: string | null;
      platform: string | null;
      is_active: boolean;
      last_seen_at: string | null;
      updated_at: string | null;
      app_version: string | null;
      fcm_token: string;
    };
    return {
      id: t.id,
      agent_id: t.agent_id,
      platform: t.platform,
      is_active: t.is_active,
      last_seen_at: t.last_seen_at,
      updated_at: t.updated_at,
      app_version: t.app_version,
      fcm_token_hint: truncar(t.fcm_token),
    };
  });
  const tokensActivos = tokens.filter((t) => t.is_active).length;

  let events: Array<Record<string, unknown>> = [];
  if (agentId) {
    const { data: evs } = await supabase
      .from("agent_notification_events")
      .select("id, type, status, channel, error_message, sent_at, created_at, provider_message_id")
      .eq("empresa_id", empresa_id)
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false })
      .limit(10);
    events = (evs ?? []).map((e) => {
      const r = e as {
        id: string;
        type: string;
        status: string;
        channel: string;
        error_message: string | null;
        sent_at: string | null;
        created_at: string | null;
        provider_message_id: string | null;
      };
      return {
        id: r.id.slice(0, 8),
        type: r.type,
        status: r.status,
        channel: r.channel,
        error_message: r.error_message,
        sent_at: r.sent_at,
        created_at: r.created_at,
        provider_message_id: r.provider_message_id ? r.provider_message_id.slice(0, 24) + "…" : null,
      };
    });
  }
  const pendingCount = events.filter((e) => e.status === "pending").length;
  const sentCount = events.filter((e) => e.status === "sent").length;
  const failedCount = events.filter((e) => e.status === "failed").length;
  const skippedCount = events.filter((e) => e.status === "skipped").length;

  const fcm = await getFcmMessaging();

  const diagnostico: string[] = [];
  if (!globalFlags.firebase_configured || !fcm.ok) {
    diagnostico.push("Firebase Admin NO configurado en el server. El dispatcher no puede mandar pushes.");
  }
  if (!globalFlags.contact_center_v1_enabled) {
    diagnostico.push(
      "CONTACT_CENTER_V1 apagado. No se crean agent_notification_events al recibir mensajes, así que no hay nada para despachar."
    );
  }
  if (!agentId) {
    diagnostico.push(
      "Tu usuario NO figura como chat_agents en esta empresa. Los eventos se crean por agent_id, no por user_id."
    );
  }
  if (agentId && tokens.length === 0) {
    diagnostico.push(
      "No hay ningún device token registrado para tu usuario. El APK no llamó /api/cc/agent/device-token, o el POST devolvió error."
    );
  }
  if (agentId && tokens.length > 0 && tokensActivos === 0) {
    diagnostico.push(
      "Tenés tokens registrados pero TODOS están is_active=false. Suele significar que FCM los rechazó como 'not registered' (APK reinstalada / token viejo) — hay que abrir la app para que reenvíe el token nuevo."
    );
  }
  if (agentId && tokensActivos > 0 && pendingCount > 0 && sentCount === 0 && failedCount === 0) {
    diagnostico.push(
      "Los eventos se crean pero se quedan pending. El cron /api/cron/cc-notifications-dispatch no se está ejecutando (revisá el schedule y CRON_SECRET en Coolify)."
    );
  }
  if (agentId && tokensActivos > 0 && failedCount > 0 && sentCount === 0) {
    diagnostico.push(
      "El cron corre y FCM rechaza los envíos. Mirá error_message en los eventos: suele ser token inválido o credencial de Firebase apuntando al project id equivocado."
    );
  }
  if (agentId && sentCount > 0) {
    diagnostico.push(
      "Del lado server todo OK: hay eventos 'sent' con provider_message_id. Si no llegan al celular, el problema es en el device (permiso de notificaciones, batería/DND, canal 'neura_inbox' silenciado en Ajustes de Android)."
    );
  }
  if (diagnostico.length === 0) {
    diagnostico.push("Estado consistente. No hay señales obvias de falla.");
  }

  return NextResponse.json({
    ok: true,
    authed: true,
    global: globalFlags,
    yo: { empresa_id, usuario_id, is_agent: agentId != null, agent_id: agentId, agent_is_active: agent?.is_active ?? null },
    tokens_summary: { total: tokens.length, activos: tokensActivos },
    tokens,
    events_summary: {
      total: events.length,
      pending: pendingCount,
      sent: sentCount,
      failed: failedCount,
      skipped: skippedCount,
    },
    events,
    diagnostico,
    timestamp: new Date().toISOString(),
  });
}
