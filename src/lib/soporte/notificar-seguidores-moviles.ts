import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { tieneAccesoMovilEspecial } from "@/lib/auth/acceso-movil-especial";
import { avisarPorPush } from "@/lib/cc/push-usuarios";

/**
 * Avisa por push a los usuarios con "acceso móvil especial" (Karen, Milagros) sobre
 * cambios de un ticket: comentarios nuevos, cambio de responsable, cambio de estado.
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
