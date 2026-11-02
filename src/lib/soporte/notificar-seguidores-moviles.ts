import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { tieneAccesoMovilEspecial } from "@/lib/auth/acceso-movil-especial";
import { avisarPorPush } from "@/lib/cc/push-usuarios";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Avisa por push a los usuarios con "acceso móvil especial" (ver
 * `acceso-movil-especial.ts`) sobre un ticket: alta (carga), comentarios nuevos,
 * cambio de responsable y cambio de estado (incluido el cierre).
 *
 * El responsable del ticket recibe su propio push por otros caminos (avisarSoporte,
 * avisarEstadoAPMs); acá solo cubrimos los seguidores móviles para no duplicar. Si una
 * de esas personas resulta ser también la responsable, se excluye del envío de este
 * helper (su push normal ya le va a llegar).
 *
 * Respeta la pref de categoría 'soporte': si el usuario la apagó en
 * /m/asesor/configuracion/notificaciones, avisarPorPush lo saltea.
 */
export async function avisarSeguidoresMovilesSoporte(args: {
  /** Cliente de datos del tenant, para insertar la campanita in-app. */
  sb: AppSupabaseClient;
  empresaId: string;
  ticketId: string;
  titulo: string;
  cuerpo: string;
  excluirUsuarioId?: string | null;
}): Promise<void> {
  try {
    const catalog = createServiceRoleClient();
    const { data } = await catalog
      .from("usuarios")
      .select("id, email")
      .eq("empresa_id", args.empresaId)
      .ilike("estado", "activo");
    const destinatarios = ((data ?? []) as { id: string; email?: string | null }[])
      .filter((u) => tieneAccesoMovilEspecial(u.email))
      .map((u) => u.id)
      .filter((id) => id !== args.excluirUsuarioId);
    if (destinatarios.length === 0) return;

    // Campanita in-app: igual que el alta, para que no sea solo push. Reusa el
    // tipo permitido 'soporte_revision' (abre el ticket desde la campana).
    const { error: insError } = await args.sb.from("usuario_notificaciones").insert(
      destinatarios.map((usuarioId) => ({
        empresa_id: args.empresaId,
        usuario_id: usuarioId,
        tipo: "soporte_revision",
        titulo: args.titulo.slice(0, 200),
        cuerpo: args.cuerpo.slice(0, 300),
        actor_id: args.excluirUsuarioId ?? null,
        metadata: { ticket_id: args.ticketId },
      })),
    );
    if (insError) console.warn("[avisarSeguidoresMovilesSoporte] campanita:", insError.message);

    await avisarPorPush({
      empresaId: args.empresaId,
      usuarioIds: destinatarios,
      titulo: args.titulo,
      cuerpo: args.cuerpo,
      ruta: `/m/asesor/soporte/${args.ticketId}`,
      agrupar: `ticket-${args.ticketId}`,
      categoria: "soporte",
    });
  } catch (e) {
    console.warn(
      "[avisarSeguidoresMovilesSoporte]",
      e instanceof Error ? e.message : String(e),
    );
  }
}
