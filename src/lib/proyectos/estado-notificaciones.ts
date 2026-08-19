import "server-only";
import type { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";

/**
 * Notificaciones in-app del movimiento de un proyecto por el Kanban.
 *
 * El destinatario es el comercial del proyecto: es quien le da la cara al
 * cliente y necesita enterarse de que algo se movió sin tener que mirar el
 * tablero. El técnico no entra acá — el movimiento normalmente lo hace él.
 *
 * Sólo al llegar a un estado final se suman los usuarios con
 * `notificar_entregas`, que reciben las entregas de toda la empresa. En los
 * pasos intermedios no participan, para que ese buzón no se llene de ruido.
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

/**
 * Usuarios activos de la empresa marcados para recibir todas las entregas.
 * Vive en el catálogo, así que va por el cliente de service-role y no por el
 * cliente del tenant.
 */
async function coordinadoresDeEntrega(empresaId: string): Promise<string[]> {
  const catalog = createServiceRoleClient();
  const { data, error } = await catalog
    .from("usuarios")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("notificar_entregas", true)
    .ilike("estado", "activo");
  if (error || !data) return [];
  return (data as { id: string }[]).map((u) => u.id);
}

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

    const destinatarios = new Set<string>();
    // El comercial recibe todos los movimientos de SUS proyectos.
    if (args.comercialId) destinatarios.add(args.comercialId);
    // Al entregar se suma quien coordina las entregas: recibe el aviso de TODOS
    // los proyectos, no sólo de los suyos. Sale del flag `notificar_entregas`
    // del catálogo y no de una lista fija en el código, porque quién ocupa ese
    // lugar cambia con el tiempo.
    if (args.esFinal) {
      for (const id of await coordinadoresDeEntrega(args.empresaId)) destinatarios.add(id);
    }
    // El que movió el proyecto no se entera de su propia acción.
    if (args.actorId) destinatarios.delete(args.actorId);
    if (destinatarios.size === 0) return;

    const { error } = await sb.from("usuario_notificaciones").insert(
      [...destinatarios].map((usuarioId) => ({
        empresa_id: args.empresaId,
        usuario_id: usuarioId,
        tipo,
        titulo,
        cuerpo,
        proyecto_id: args.proyectoId,
        actor_id: args.actorId,
        agrupadas: 1,
      }))
    );

    if (error) {
      console.error("[estado-notificaciones] no se pudo insertar la notificación", error.message);
    }
  } catch (e) {
    console.error("[estado-notificaciones] no se pudo notificar el cambio de estado", e);
  }
}
