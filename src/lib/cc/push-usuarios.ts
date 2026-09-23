import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { getFcmMessaging } from "@/lib/cc/firebase-admin";

/**
 * Push de los avisos de la campanita al celular (app nativa).
 *
 * El Contact Center ya tenía push, pero SOLO para asesores de chat: la cola
 * `agent_notification_events` va por `agent_id`, así que quien no es asesor (PM, QA,
 * Desarrollo, supervisión) nunca recibía nada aunque tuviera la app instalada.
 *
 * Acá el envío es directo, sin cola: el aviso ya quedó guardado en `usuario_notificaciones`
 * y esto solo lo repite en el teléfono. Si falla, se pierde el push pero NUNCA el aviso: la
 * campanita y la pantalla de Avisos lo siguen mostrando. Por eso nada de esto lanza.
 */
export type AvisoPush = {
  empresaId: string;
  usuarioIds: (string | null | undefined)[];
  titulo: string;
  cuerpo: string;
  /** A dónde lleva el toque, p. ej. "/m/asesor/proyectos/<id>". */
  ruta?: string | null;
  /** Misma clave = la notificación nueva reemplaza a la anterior en vez de apilarse. */
  agrupar?: string | null;
};

export async function avisarPorPush(aviso: AvisoPush): Promise<void> {
  try {
    await enviar(aviso);
  } catch (e) {
    console.warn("[push-usuarios] no se pudo enviar:", e instanceof Error ? e.message : String(e));
  }
}

async function enviar(aviso: AvisoPush): Promise<void> {
  const usuarios = [...new Set(aviso.usuarioIds.filter((u): u is string => Boolean(u)))];
  if (usuarios.length === 0) return;

  const fcm = await getFcmMessaging();
  if (!fcm.ok) return; // sin credenciales no hay push; el aviso ya está guardado

  const sb = createServiceRoleClient();
  const { data, error } = await sb
    .from("agent_device_tokens")
    .select("fcm_token")
    .eq("empresa_id", aviso.empresaId)
    .eq("is_active", true)
    .in("user_id", usuarios);
  if (error) {
    console.warn("[push-usuarios] tokens:", error.message);
    return;
  }
  const tokens = [...new Set(((data ?? []) as { fcm_token: string }[]).map((t) => t.fcm_token).filter(Boolean))];
  if (tokens.length === 0) return;

  const res = await fcm.messaging.sendEachForMulticast({
    tokens,
    notification: { title: aviso.titulo.slice(0, 120), body: aviso.cuerpo.slice(0, 240) },
    data: { ruta: aviso.ruta ?? "", tipo: "aviso" },
    android: {
      priority: "high",
      notification: {
        channelId: "neura_inbox",
        sound: "noti",
        ...(aviso.agrupar ? { tag: aviso.agrupar } : {}),
      },
    },
    apns: {
      payload: { aps: { sound: "default" } },
      ...(aviso.agrupar ? { headers: { "apns-collapse-id": aviso.agrupar.slice(0, 64) } } : {}),
    },
  });

  // Token de un teléfono que borró la app: se apaga para no reintentar siempre.
  const muertos = res.responses
    .map((r, i) => (r.success ? null : tokens[i]))
    .filter((t, i): t is string => {
      if (!t) return false;
      const code = (res.responses[i].error as { code?: string } | undefined)?.code ?? "";
      return code.includes("registration-token-not-registered") || code.includes("invalid-argument");
    });
  if (muertos.length > 0) {
    await sb
      .from("agent_device_tokens")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .in("fcm_token", muertos);
  }
}
