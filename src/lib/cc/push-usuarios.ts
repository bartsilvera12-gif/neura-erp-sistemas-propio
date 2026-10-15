import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { getFcmMessaging, getFcmMessagingSecundario } from "@/lib/cc/firebase-admin";

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

  // El mensaje se arma una vez: si hay que reintentar con el otro proyecto de
  // Firebase, tiene que irse exactamente el mismo. `as const` en la prioridad
  // porque fuera del literal TypeScript la ve como `string` y deja de encajar.
  const mensaje = {
    notification: { title: aviso.titulo.slice(0, 120), body: aviso.cuerpo.slice(0, 240) },
    data: { ruta: aviso.ruta ?? "", tipo: "aviso" },
    android: {
      priority: "high" as const,
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
  };

  const res = await fcm.messaging.sendEachForMulticast({ tokens, ...mensaje });

  /**
   * Este camino es el que avisa a quien NO es asesor: supervisión, PM,
   * administración. Y hasta ahora mandaba sólo con el proyecto de Firebase
   * principal.
   *
   * Un token de FCM no es la dirección de un teléfono: es la de un teléfono
   * DENTRO de un proyecto. La app Zentra tiene el suyo
   * (`zentra-app-android`), así que todos sus teléfonos fallaban acá por más
   * que estuvieran bien instalados y con el permiso dado. El arreglo de los dos
   * proyectos se había hecho sólo en el despacho por `agent_id`, que es el otro
   * camino — el de quien tiene la conversación asignada.
   */
  const muertos: string[] = [];
  const paraReintentar: string[] = [];
  res.responses.forEach((r, i) => {
    if (r.success) return;
    const code = (r.error as { code?: string } | undefined)?.code ?? "";
    if (code.includes("registration-token-not-registered")) {
      // Lo único que significa "este teléfono ya no existe".
      muertos.push(tokens[i]);
    } else {
      // Todo lo demás —`mismatched-credential`, `invalid-argument`— puede ser
      // un token de otro proyecto. Antes `invalid-argument` se tomaba como
      // teléfono muerto y se apagaba, que es justo lo contrario de lo que hay
      // que hacer: el teléfono está vivo y hay que mandarle por el otro lado.
      paraReintentar.push(tokens[i]);
    }
  });

  if (paraReintentar.length > 0) {
    const alterno = await getFcmMessagingSecundario();
    if (!alterno) {
      console.warn(
        `[push-usuarios] ${paraReintentar.length} token(s) que el proyecto principal no reconoce, ` +
          "y no hay un proyecto secundario configurado. Revisá FIREBASE_SECUNDARIO_SERVICE_ACCOUNT_JSON_BASE64.",
      );
    } else {
      const res2 = await alterno.sendEachForMulticast({ tokens: paraReintentar, ...mensaje });
      res2.responses.forEach((r, i) => {
        if (r.success) return;
        const code = (r.error as { code?: string } | undefined)?.code ?? "";
        // Sólo acá se apaga, y sólo por la única causa que lo justifica. Un
        // error de credencial es un problema del servidor: apagar el teléfono
        // por eso deja a alguien sin avisos y sin rastro de por qué.
        if (code.includes("registration-token-not-registered")) muertos.push(paraReintentar[i]);
      });
    }
  }

  if (muertos.length > 0) {
    await sb
      .from("agent_device_tokens")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .in("fcm_token", muertos);
  }
}
