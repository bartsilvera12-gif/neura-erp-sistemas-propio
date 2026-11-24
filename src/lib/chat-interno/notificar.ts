import "server-only";

/**
 * Aviso en la campanita por un mensaje del chat interno.
 *
 * Nunca lanza: el mensaje YA se guardó y un problema del aviso no puede
 * voltear el envío. Un chat que falla al notificar sigue siendo un chat; uno
 * que pierde el mensaje, no.
 */

import { avisarPorPush } from "@/lib/cc/push-usuarios";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

export async function notificarMensajeChat(
  sb: AppSupabaseClient,
  args: {
    empresaId: string;
    salaId: string;
    salaNombre: string;
    salaTipo: string;
    autorId: string;
    autorNombre: string;
    texto: string;
    /** Mencionados con @: reciben aunque tengan la sala silenciada por lectura. */
    menciones: string[];
  }
): Promise<void> {
  try {
    const { data } = await sb
      .from("chat_interno_miembros")
      .select("usuario_id, ultima_lectura_at")
      .eq("sala_id", args.salaId);

    const miembros = (data ?? []) as { usuario_id: string; ultima_lectura_at: string | null }[];
    const mencionados = new Set(args.menciones);

    // Se avisa a quien NO está mirando la sala. Con la sala abierta, visible y
    // con foco, la pantalla marca leído en cada mensaje que llega y como mínimo
    // cada 20 s: una lectura de los últimos 45 s es alguien mirando.
    //
    // Ojo: escribir también mueve `ultima_lectura_at` (a la hora exacta de su
    // propio mensaje). Eso NO es estar mirando: quien responde y se va a otra
    // pantalla tiene que enterarse de la contestación. Antes, con 2 minutos de
    // margen y sin esta distinción, en una charla de ida y vuelta casi nada
    // sonaba. Al mencionado se le avisa igual — mencionar es pedir que mire.
    const ventana = Date.now() - 45 * 1000;
    const leidoDe = (m: { ultima_lectura_at: string | null }) => {
      const t = m.ultima_lectura_at ? Date.parse(m.ultima_lectura_at) : 0;
      return Number.isFinite(t) ? t : 0;
    };
    const candidatos = miembros.filter((m) => m.usuario_id !== args.autorId);
    const recientes = candidatos.filter((m) => leidoDe(m) > ventana);

    // Último mensaje propio de cada "reciente": si su lectura coincide con la
    // hora de ese mensaje, la puso el envío y no la pantalla.
    const ultimoPropio = new Map<string, number>();
    if (recientes.length > 0) {
      const { data: propios } = await sb
        .from("chat_interno_mensajes")
        .select("usuario_id, created_at")
        .eq("sala_id", args.salaId)
        .in("usuario_id", recientes.map((m) => m.usuario_id))
        .gte("created_at", new Date(ventana - 1000).toISOString())
        .order("created_at", { ascending: false });
      for (const r of (propios ?? []) as { usuario_id: string; created_at: string }[]) {
        if (!ultimoPropio.has(r.usuario_id)) ultimoPropio.set(r.usuario_id, Date.parse(r.created_at));
      }
    }

    const destinatarios = candidatos
      .filter((m) => {
        if (mencionados.has(m.usuario_id)) return true;
        const leido = leidoDe(m);
        if (leido <= ventana) return true;
        const propio = ultimoPropio.get(m.usuario_id);
        return propio != null && Math.abs(propio - leido) < 1000;
      })
      .map((m) => m.usuario_id);

    if (destinatarios.length === 0) return;

    const extracto = args.texto.trim().replace(/\s+/g, " ").slice(0, 120) || "Archivo adjunto";
    const donde = args.salaTipo === "grupo" ? ` · ${args.salaNombre}` : "";

    const catalog = createServiceRoleClient();
    const filas = destinatarios.map((usuarioId) => {
      const mencionado = mencionados.has(usuarioId);
      return {
        empresa_id: args.empresaId,
        usuario_id: usuarioId,
        tipo: "chat_interno_mensaje",
        titulo: mencionado ? `Te mencionaron${donde}` : `Chat${donde}`,
        cuerpo: `${args.autorNombre}${mencionado ? " te mencionó" : ""}: ${extracto}`,
        actor_id: args.autorId,
        metadata: { sala_id: args.salaId, mencion: mencionado },
      };
    });

    // Va por el catálogo porque `usuario_notificaciones` vive ahí, igual que el
    // resto de los avisos del sistema.
    const { error } = await catalog.from("usuario_notificaciones").insert(filas);
    if (error) console.error("[chat-interno] no se pudo notificar", error.message);

    // Y al celular, como el resto de los avisos. Antes sólo quedaba en la
    // campanita: en la app nunca aparecía ni sonaba. La categoría "chat" la
    // puede apagar cada uno en su configuración de notificaciones.
    await Promise.all(
      filas.map((f) =>
        avisarPorPush({
          empresaId: args.empresaId,
          usuarioIds: [f.usuario_id],
          titulo: f.titulo,
          cuerpo: f.cuerpo,
          ruta: "/m/asesor/avisos",
          agrupar: `chat-interno-${args.salaId}`,
          categoria: "chat",
        })
      )
    );
  } catch (e) {
    console.error("[chat-interno] no se pudo notificar", e);
  }
}
