import "server-only";
import type { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import type { QAAccion } from "@/lib/proyectos/qa-shared";

/**
 * Generación de notificaciones in-app a partir de la actividad de QA.
 *
 * Se engancha en `registrarEventoQA()` —el único punto por donde pasan los 25
 * endpoints de QA— en vez de en cada ruta. La contrapartida es que este módulo
 * no puede tirar nunca: una notificación que falla no puede voltear la carga de
 * una observación. Todo va envuelto en try/catch con log.
 */

type NotifSupabase = Awaited<ReturnType<typeof getChatServiceClientForEmpresa>>;

export type TipoNotificacion = "qa_novedad" | "qa_aprobado" | "qa_rechazado";

/** Texto corto por acción, para el cuerpo de la notificación agrupada. */
const ACCION_LEGIBLE: Record<QAAccion, string> = {
  grupo_creado: "creó un grupo",
  grupo_editado: "editó un grupo",
  grupo_eliminado: "eliminó un grupo",
  etapa_creada: "creó una etapa",
  etapa_editada: "editó una etapa",
  etapa_eliminada: "eliminó una etapa",
  item_creado: "agregó un ítem",
  item_editado: "editó un ítem",
  item_eliminado: "eliminó un ítem",
  item_marcado: "marcó un ítem",
  item_desmarcado: "desmarcó un ítem",
  comentario_editado: "editó un comentario",
  archivo_subido: "subió un archivo",
  archivo_eliminado: "eliminó un archivo",
  qa_clonado: "clonó un checklist",
  observacion_creada: "cargó una observación",
  observacion_editada: "editó una observación",
  observacion_eliminada: "eliminó una observación",
  observacion_estado_cambiado: "cambió el estado de una observación",
  observacion_asignada: "asignó una observación",
  observacion_comentada: "comentó una observación",
  observacion_archivo_subido: "adjuntó un archivo a una observación",
  observacion_archivo_eliminado: "quitó un archivo de una observación",
  seccion_creada: "creó una sección",
  seccion_editada: "editó una sección",
  seccion_eliminada: "eliminó una sección",
  qa_aprobado: "aprobó el proyecto",
  qa_rechazado: "rechazó el proyecto",
};

/**
 * El veredicto ya emite su propia notificación tipada (`qa_aprobado` /
 * `qa_rechazado`), que va a destinatarios distintos y no se agrupa. Sin esta
 * exclusión aprobar generaría además una `qa_novedad` que diría "1 novedad ·
 * aprobó el proyecto", duplicando el aviso.
 */
const ACCIONES_SIN_NOVEDAD = new Set<QAAccion>(["qa_aprobado", "qa_rechazado"]);

type ProyectoDestinatarios = {
  titulo: string;
  responsable_comercial_id: string | null;
  responsable_tecnico_id: string | null;
};

async function leerProyecto(
  sb: NotifSupabase,
  empresaId: string,
  proyectoId: string
): Promise<ProyectoDestinatarios | null> {
  const { data, error } = await sb
    .from("proyectos")
    .select("titulo, responsable_comercial_id, responsable_tecnico_id")
    .eq("empresa_id", empresaId)
    .eq("id", proyectoId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as {
    titulo?: string | null;
    responsable_comercial_id?: string | null;
    responsable_tecnico_id?: string | null;
  };
  return {
    titulo: (row.titulo ?? "").trim() || "un proyecto",
    responsable_comercial_id: row.responsable_comercial_id ?? null,
    responsable_tecnico_id: row.responsable_tecnico_id ?? null,
  };
}

/** Los responsables del proyecto, sin repetidos y sin el autor de la acción. */
function destinatariosResponsables(
  p: ProyectoDestinatarios,
  actorId: string | null
): string[] {
  const ids = new Set<string>();
  if (p.responsable_comercial_id) ids.add(p.responsable_comercial_id);
  if (p.responsable_tecnico_id) ids.add(p.responsable_tecnico_id);
  if (actorId) ids.delete(actorId);
  return [...ids];
}

/**
 * Las project managers de la empresa. Es un flag del catálogo y no un valor de
 * `usuarios.rol`, porque `rol` gobierna los permisos de todo el ERP.
 */
async function projectManagers(empresaId: string, excluirId: string | null): Promise<string[]> {
  const catalog = createServiceRoleClient();
  const { data, error } = await catalog
    .from("usuarios")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("es_project_manager", true);
  if (error || !data) return [];
  return (data as { id: string }[])
    .map((u) => u.id)
    .filter((id) => id !== excluirId);
}

/**
 * Inserta o refresca la `qa_novedad` sin leer de ese usuario en ese proyecto.
 *
 * El agrupado es lo que evita que una sesión de QA cargando 15 observaciones
 * produzca 15 notificaciones: si ya hay una sin leer se le suma uno al contador
 * y se le refresca la fecha, para que suba al tope del panel como novedad.
 *
 * El índice único parcial `(empresa_id, usuario_id, proyecto_id) WHERE
 * tipo='qa_novedad' AND leida_at IS NULL` es lo que hace esto seguro entre
 * requests concurrentes: si dos llegan juntas, una inserta y la otra choca con
 * el índice y reintenta el update.
 */
async function upsertNovedad(
  sb: NotifSupabase,
  args: {
    empresaId: string;
    usuarioId: string;
    proyectoId: string;
    tituloProyecto: string;
    accion: QAAccion;
    actorId: string | null;
    observacionId: string | null;
  }
): Promise<void> {
  const ahora = new Date().toISOString();
  const cuerpoUltima = ACCION_LEGIBLE[args.accion] ?? "registró un cambio";

  const actualizar = async (): Promise<boolean> => {
    const { data: existente } = await sb
      .from("usuario_notificaciones")
      .select("id, agrupadas")
      .eq("empresa_id", args.empresaId)
      .eq("usuario_id", args.usuarioId)
      .eq("proyecto_id", args.proyectoId)
      .eq("tipo", "qa_novedad")
      .is("leida_at", null)
      .maybeSingle();

    const row = existente as { id: string; agrupadas: number | null } | null;
    if (!row) return false;

    const total = Number(row.agrupadas ?? 1) + 1;
    await sb
      .from("usuario_notificaciones")
      .update({
        agrupadas: total,
        cuerpo: `${total} novedades · última: ${cuerpoUltima}`,
        created_at: ahora,
        actor_id: args.actorId,
        observacion_id: args.observacionId,
      })
      .eq("empresa_id", args.empresaId)
      .eq("id", row.id);
    return true;
  };

  if (await actualizar()) return;

  const { error } = await sb.from("usuario_notificaciones").insert({
    empresa_id: args.empresaId,
    usuario_id: args.usuarioId,
    tipo: "qa_novedad",
    titulo: `QA · ${args.tituloProyecto}`,
    cuerpo: `1 novedad · ${cuerpoUltima}`,
    proyecto_id: args.proyectoId,
    observacion_id: args.observacionId,
    actor_id: args.actorId,
    agrupadas: 1,
  });

  // Carrera perdida contra otro request: la fila ya existe, sumamos ahí.
  if (error) await actualizar();
}

/**
 * Notificación de novedad de QA a los responsables del proyecto.
 * Nunca lanza: la llama `registrarEventoQA`, y un fallo acá no puede abortar
 * la operación de QA que la originó.
 */
export async function notificarNovedadQA(
  sb: NotifSupabase,
  args: {
    empresaId: string;
    proyectoId: string;
    actorId: string | null;
    accion: QAAccion;
    observacionId?: string | null;
  }
): Promise<void> {
  try {
    if (ACCIONES_SIN_NOVEDAD.has(args.accion)) return;

    const proyecto = await leerProyecto(sb, args.empresaId, args.proyectoId);
    if (!proyecto) return;

    const destinatarios = destinatariosResponsables(proyecto, args.actorId);
    for (const usuarioId of destinatarios) {
      await upsertNovedad(sb, {
        empresaId: args.empresaId,
        usuarioId,
        proyectoId: args.proyectoId,
        tituloProyecto: proyecto.titulo,
        accion: args.accion,
        actorId: args.actorId,
        observacionId: args.observacionId ?? null,
      });
    }
  } catch (e) {
    console.error("[qa-notificaciones] no se pudo notificar la novedad", e);
  }
}

/**
 * Notificación del veredicto de QA.
 *
 * Va sólo a quien tiene que hacer algo con él: el programador, que corrige o
 * entrega, y la project manager cuando el proyecto queda aprobado, porque es el
 * hito que dispara la entrega. El comercial queda afuera a propósito: se entera
 * por las novedades de QA, y el ida y vuelta técnico no le pide ninguna acción.
 *
 * No se agrupa: cada veredicto es un hecho puntual y merece su propia fila.
 */
export async function notificarVeredictoQA(
  sb: NotifSupabase,
  args: {
    empresaId: string;
    proyectoId: string;
    actorId: string | null;
    aprobado: boolean;
    motivo?: string | null;
  }
): Promise<void> {
  try {
    const proyecto = await leerProyecto(sb, args.empresaId, args.proyectoId);
    if (!proyecto) return;

    const ids = new Set<string>();
    if (
      proyecto.responsable_tecnico_id &&
      proyecto.responsable_tecnico_id !== args.actorId
    ) {
      ids.add(proyecto.responsable_tecnico_id);
    }
    if (args.aprobado) {
      for (const pm of await projectManagers(args.empresaId, args.actorId)) ids.add(pm);
    }
    if (ids.size === 0) return;

    const tipo: TipoNotificacion = args.aprobado ? "qa_aprobado" : "qa_rechazado";
    const titulo = args.aprobado
      ? `QA aprobó · ${proyecto.titulo}`
      : `QA rechazó · ${proyecto.titulo}`;
    const motivo = (args.motivo ?? "").trim();
    const cuerpo = args.aprobado
      ? motivo || "Listo para entregar."
      : motivo || "Volvió a Cambios.";

    const filas = [...ids].map((usuarioId) => ({
      empresa_id: args.empresaId,
      usuario_id: usuarioId,
      tipo,
      titulo,
      cuerpo,
      proyecto_id: args.proyectoId,
      actor_id: args.actorId,
      agrupadas: 1,
    }));

    await sb.from("usuario_notificaciones").insert(filas);
  } catch (e) {
    console.error("[qa-notificaciones] no se pudo notificar el veredicto", e);
  }
}
