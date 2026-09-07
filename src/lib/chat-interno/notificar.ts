import "server-only";

/**
 * Aviso en la campanita por un mensaje del chat interno.
 *
 * Nunca lanza: el mensaje YA se guardó y un problema del aviso no puede
 * voltear el envío. Un chat que falla al notificar sigue siendo un chat; uno
 * que pierde el mensaje, no.
 */

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

    // Se avisa a quien NO está mirando la sala. Quien la leyó hace menos de dos
    // minutos la tiene abierta: mandarle una notificación sería avisarle de algo
    // que está viendo. Al mencionado se le avisa igual — mencionar es pedir
    // explícitamente que mire.
    const hace2min = Date.now() - 2 * 60 * 1000;
    const destinatarios = miembros
      .filter((m) => m.usuario_id !== args.autorId)
      .filter((m) => {
        if (mencionados.has(m.usuario_id)) return true;
        const leido = m.ultima_lectura_at ? Date.parse(m.ultima_lectura_at) : 0;
        return !(Number.isFinite(leido) && leido > hace2min);
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
  } catch (e) {
    console.error("[chat-interno] no se pudo notificar", e);
  }
}
