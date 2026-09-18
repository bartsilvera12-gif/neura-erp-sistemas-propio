import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { getFcmMessaging } from "@/lib/cc/firebase-admin";

/**
 * Despacho de las notificaciones push del Contact Center (agent_notification_events
 * pending/fcm → FCM). Lo usan el cron `/api/cron/cc-notifications-dispatch` y, en caliente,
 * el webhook de YCloud apenas entra un mensaje (ver `dispararDespachoPush`).
 *
 * Antes dependía SOLO del scheduled task de Coolify: cuando ese task dejó de correr, los
 * eventos quedaron horas en `pending` y a los asesores no les llegaba nada.
 */
const TITLES: Record<string, string> = {
  new_lead: "Nuevo lead asignado",
  new_message: "Nuevo mensaje",
  reassigned: "Conversación reasignada",
  sla_warning: "Lead sin responder",
};

export async function despacharNotificacionesPendientes(opts: { dryRun?: boolean; limit?: number } = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const dryRun = Boolean(opts.dryRun);
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100));

  const fcm = await getFcmMessaging();
  if (!fcm.ok && fcm.reason === "config_missing" && !dryRun) {
    return { status: 200, body: {
        ok: false,
        error: "config_missing",
        missing: fcm.missing,
        hint: "Configurar credenciales Firebase en Coolify (ver docs/CAPACITOR_PUSH_SETUP.md). Los eventos quedan pending.",
      } };
  }

  let sb;
  try {
    sb = createServiceRoleClient();
  } catch (e) {
    return { status: 500, body: { ok: false, error: `cliente service-role no disponible: ${e instanceof Error ? e.message : String(e)}` } };
  }
  const nowIso = () => new Date().toISOString();

  const { data: pend, error: pendErr } = await sb
    .from("agent_notification_events")
    .select("id, agent_id, conversation_id, type")
    .eq("status", "pending")
    .eq("channel", "fcm")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (pendErr) {
    return { status: 500, body: { ok: false, error: `query pending falló: ${pendErr.message}` } };
  }

  const events = (pend ?? []) as Array<{
    id: string;
    agent_id: string | null;
    conversation_id: string | null;
    type: string;
  }>;
  let sent = 0,
    failed = 0,
    skipped = 0,
    wouldSend = 0;
  const detail: Array<Record<string, unknown>> = [];

  for (const ev of events) {
    let tokens: string[] = [];
    if (ev.agent_id) {
      const { data: tk } = await sb
        .from("agent_device_tokens")
        .select("fcm_token")
        .eq("agent_id", ev.agent_id)
        .eq("is_active", true);
      tokens = ((tk ?? []) as Array<{ fcm_token: string }>).map((r) => r.fcm_token).filter(Boolean);
    }
    if (tokens.length === 0) {
      if (!dryRun) {
        const { error: upErr } = await sb
          .from("agent_notification_events")
          .update({ status: "skipped", error_message: "no_active_device" })
          .eq("id", ev.id);
        if (upErr) {
          failed++;
          detail.push({ event: ev.id.slice(0, 8), result: "status_update_failed", stage: "skipped", error: upErr.message.slice(0, 160) });
          continue;
        }
      }
      skipped++;
      detail.push({ event: ev.id.slice(0, 8), result: "skipped_no_device" });
      continue;
    }

    let body = "Tenés un nuevo mensaje";
    let preview = "";
    let contactId: string | null = null;
    if (ev.conversation_id) {
      const { data: conv } = await sb
        .from("chat_conversations")
        .select("last_message_preview, contact_id")
        .eq("id", ev.conversation_id)
        .maybeSingle();
      preview = ((conv as { last_message_preview?: string | null } | null)?.last_message_preview ?? "").toString().trim();
      let who = "";
      contactId = (conv as { contact_id?: string | null } | null)?.contact_id ?? null;
      if (contactId) {
        const { data: ct } = await sb
          .from("chat_contacts")
          .select("nombre, telefono")
          .eq("id", contactId)
          .maybeSingle();
        who = (
          (ct as { nombre?: string | null } | null)?.nombre ||
          (ct as { telefono?: string | null } | null)?.telefono ||
          ""
        )
          .toString()
          .trim();
      }
      body = who ? (preview ? `${who}: ${preview}`.slice(0, 140) : who) : preview ? preview.slice(0, 140) : body;
    }
    let title = TITLES[ev.type] ?? "Notificación";
    // new_message: título = nombre/teléfono del contacto (columnas reales name/phone_number),
    // cuerpo = preview del mensaje. new_lead y los demás tipos quedan igual (arriba).
    if (ev.type === "new_message") {
      let whoMsg = "";
      if (contactId) {
        const { data: ctm } = await sb
          .from("chat_contacts")
          .select("name, phone_number")
          .eq("id", contactId)
          .maybeSingle();
        whoMsg = (
          (ctm as { name?: string | null } | null)?.name ||
          (ctm as { phone_number?: string | null } | null)?.phone_number ||
          ""
        )
          .toString()
          .trim();
      }
      title = whoMsg || "Nuevo mensaje";
      body = preview ? preview.slice(0, 140) : "Nuevo mensaje";
    }
    const route = ev.conversation_id ? `/m/asesor/chat/${ev.conversation_id}` : "/m/asesor";

    if (dryRun) {
      wouldSend++;
      detail.push({ event: ev.id.slice(0, 8), tokens: tokens.length, would_send: true, title });
      continue;
    }
    if (!fcm.ok) {
      failed++;
      const { error: upErr } = await sb
        .from("agent_notification_events")
        .update({ status: "failed", error_message: `fcm_${fcm.reason}` })
        .eq("id", ev.id);
      detail.push({ event: ev.id.slice(0, 8), result: "fcm_unavailable", status_persisted: !upErr });
      continue;
    }

    try {
      // Colapsar por conversación: un contacto que manda seis audios seguidos genera
      // seis eventos (uno por mensaje entrante, por diseño), y sin esto el asesor ve
      // seis tarjetas apiladas. Con la misma clave, el sistema operativo reemplaza la
      // notificación anterior de esa conversación en lugar de acumularla — como WhatsApp.
      // Sólo si hay conversación: con clave vacía colapsaríamos notificaciones de
      // conversaciones distintas entre sí, que es peor que no colapsar.
      const collapseId = ev.conversation_id ?? null;
      const res = await fcm.messaging.sendEachForMulticast({
        tokens,
        notification: { title, body },
        data: { conversationId: ev.conversation_id ?? "", route, type: ev.type, agentId: ev.agent_id ?? "" },
        android: {
          priority: "high",
          notification: { channelId: "neura_inbox", sound: "noti" },
          ...(collapseId ? { collapseKey: collapseId } : {}),
        },
        apns: {
          // iOS sólo reproduce sonido si el payload trae `aps.sound`; sin esto la
          // notificación llegaba muda aunque el teléfono tuviera volumen. El sonido
          // "noti" de Android no sirve acá: no existe en el bundle iOS, e iOS no acepta
          // mp3 para notificaciones (sólo aiff/wav/caf). "default" no necesita archivo.
          payload: { aps: { sound: "default" } },
          ...(collapseId ? { headers: { "apns-collapse-id": collapseId } } : {}),
        },
      });
      const toDeactivate: string[] = [];
      res.responses.forEach((r, i) => {
        if (!r.success) {
          const code = (r.error as { code?: string } | undefined)?.code ?? "";
          if (code.includes("registration-token-not-registered") || code.includes("invalid-argument")) {
            toDeactivate.push(tokens[i]);
          }
        }
      });
      if (toDeactivate.length > 0) {
        await sb
          .from("agent_device_tokens")
          .update({ is_active: false, updated_at: nowIso() })
          .in("fcm_token", toDeactivate);
      }
      if (res.successCount > 0) {
        const msgId = res.responses.find((r) => r.success)?.messageId ?? null;
        const { error: upErr } = await sb
          .from("agent_notification_events")
          .update({ status: "sent", provider_message_id: msgId, sent_at: nowIso() })
          .eq("id", ev.id);
        if (upErr) {
          // El push se envió, pero no se pudo persistir 'sent'. NO contarlo como éxito:
          // si quedara 'pending' se reenviaría en el próximo tick. Se reporta como fallo visible.
          failed++;
          detail.push({ event: ev.id.slice(0, 8), result: "sent_but_status_not_persisted", error: upErr.message.slice(0, 160) });
        } else {
          sent++;
          detail.push({ event: ev.id.slice(0, 8), result: "sent", ok: res.successCount, fail: res.failureCount });
        }
      } else {
        const { error: upErr } = await sb
          .from("agent_notification_events")
          .update({ status: "failed", error_message: `all_failed(${res.failureCount})` })
          .eq("id", ev.id);
        failed++;
        detail.push({ event: ev.id.slice(0, 8), result: "failed", fail: res.failureCount, status_persisted: !upErr });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const { error: upErr } = await sb
        .from("agent_notification_events")
        .update({ status: "failed", error_message: msg.slice(0, 300) })
        .eq("id", ev.id);
      failed++;
      detail.push({ event: ev.id.slice(0, 8), result: "error", status_persisted: !upErr });
    }
  }

  return { status: 200, body: {
    ok: true,
    dry_run: dryRun,
    scanned: events.length,
    sent,
    failed,
    skipped,
    would_send: wouldSend,
    firebase_configured: fcm.ok,
    detail,
  } };
}

let enCurso: Promise<unknown> | null = null;
let ultimo = 0;

/**
 * Despacha lo pendiente sin bloquear a quien llama. Una sola corrida a la vez por proceso
 * (evita mandar dos veces el mismo evento) y como mucho una cada 2 s: el webhook recibe
 * ráfagas de estados y no hace falta consultar la cola por cada uno. El cron sigue como
 * respaldo; si coincidiera, la notificación repetida reemplaza a la anterior en el
 * teléfono (misma clave de colapso por conversación).
 */
export function dispararDespachoPush(): Promise<unknown> {
  const ahora = Date.now();
  if (enCurso || ahora - ultimo < 2000) return enCurso ?? Promise.resolve();
  ultimo = ahora;
  enCurso = despacharNotificacionesPendientes({ limit: 50 })
    .then((r) => {
      const b = r.body as { sent?: number; failed?: number };
      if ((b.sent ?? 0) > 0 || (b.failed ?? 0) > 0) {
        console.info("[push-inline]", { sent: b.sent ?? 0, failed: b.failed ?? 0 });
      }
    })
    .catch((e) => console.warn("[push-inline] falló", e instanceof Error ? e.message : String(e)))
    .finally(() => {
      enCurso = null;
    });
  return enCurso;
}
