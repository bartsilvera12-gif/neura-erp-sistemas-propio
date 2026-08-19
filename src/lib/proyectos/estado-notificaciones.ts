import "server-only";
import type { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";

/**
 * Notificaciones in-app del movimiento de un proyecto por el Kanban.
 *
 * El destinatario es el comercial del proyecto: es quien le da la cara al
 * cliente y necesita enterarse de que algo se movió sin tener que mirar el
 * tablero. El técnico no entra acá — el movimiento normalmente lo hace él.
 *
 * Se emiten dos tipos, para que llegar a "Entregado" no se pierda entre los
 * pasos intermedios:
 *   * `proyecto_entregado`     — el estado destino es final.
 *   * `proyecto_estado_cambio` — cualquier otro movimiento.
 *
 * Igual que las de QA, este módulo NUNCA lanza: una notificación que falla no
 * puede voltear un cambio de estado que ya quedó guardado. Si el CHECK de
 * `usuario_notificaciones` todavía no admite estos tipos (ver la migración
 * 20260819120000), el insert falla, se loguea y el cambio de estado sigue
 * siendo válido.
 */

type NotifSupabase = Awaited<ReturnType<typeof getChatServiceClientForEmpresa>>;

export type TipoNotificacionEstado = "proyecto_estado_cambio" | "proyecto_entregado";

export async function notificarCambioEstado(
  sb: NotifSupabase,
  args: {
    empresaId: string;
    proyectoId: string;
    tituloProyecto: string;
    /** Comercial del proyecto. Sin comercial no hay a quién avisarle. */
    comercialId: string | null;
    /** Quién movió el proyecto: no se auto-notifica. */
    actorId: string | null;
    estadoAnteriorNombre: string | null;
    estadoNuevoNombre: string;
    esFinal: boolean;
  }
): Promise<void> {
  try {
    if (!args.comercialId) return;
    if (args.comercialId === args.actorId) return;

    const tipo: TipoNotificacionEstado = args.esFinal
      ? "proyecto_entregado"
      : "proyecto_estado_cambio";

    const titulo = args.esFinal
      ? `Entregado · ${args.tituloProyecto}`
      : `${args.estadoNuevoNombre} · ${args.tituloProyecto}`;

    // El "de dónde venía" es la mitad útil del aviso: sin eso el comercial no
    // sabe si el proyecto avanzó o retrocedió.
    const cuerpo = args.estadoAnteriorNombre
      ? `Pasó de ${args.estadoAnteriorNombre} a ${args.estadoNuevoNombre}.`
      : `Pasó a ${args.estadoNuevoNombre}.`;

    const { error } = await sb.from("usuario_notificaciones").insert({
      empresa_id: args.empresaId,
      usuario_id: args.comercialId,
      tipo,
      titulo,
      cuerpo,
      proyecto_id: args.proyectoId,
      actor_id: args.actorId,
      agrupadas: 1,
    });

    if (error) {
      console.error("[estado-notificaciones] no se pudo insertar la notificación", error.message);
    }
  } catch (e) {
    console.error("[estado-notificaciones] no se pudo notificar el cambio de estado", e);
  }
}
