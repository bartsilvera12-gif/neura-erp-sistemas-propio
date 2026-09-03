import "server-only";
import type { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";
import type { CanalComentario } from "@/lib/proyectos/comentarios-permisos";

/**
 * Notificaciones in-app cuando se deja un comentario en un proyecto.
 *
 * Lógica de destinatarios (siempre se excluye al autor):
 *   - Canal 'comercial':
 *       · lo escribe un comercial   -> PM + QA (global).
 *       · lo escribe un PM/QA/admin  -> comercial asignado al proyecto.
 *   - Canal 'desarrollo':
 *       · lo escribe un técnico       -> PM + QA (global).
 *       · lo escribe un PM/QA/admin   -> técnico asignado al proyecto.
 *   - Los ADMIN reciben SIEMPRE (cualquier comentario, cualquier canal).
 *
 * En una frase: se avisa al "otro lado" del canal, más los admins. El rol del
 * autor se resuelve por flags globales (es_project_manager, es_qa, rol admin) y
 * por asignación en el proyecto (qa_responsable_id), igual que `permisoComentariosDe`.
 *
 * Nunca lanza: la llama el POST de comentarios y un fallo de aviso no puede
 * voltear el guardado del comentario.
 */

type NotifSupabase = Awaited<ReturnType<typeof getChatServiceClientForEmpresa>>;

type ProyectoDatos = {
  titulo: string;
  responsable_comercial_id: string | null;
  responsable_tecnico_id: string | null;
  qa_responsable_id: string | null;
};

async function leerProyecto(
  sb: NotifSupabase,
  empresaId: string,
  proyectoId: string
): Promise<ProyectoDatos | null> {
  const { data, error } = await sb
    .from("proyectos")
    .select("titulo, responsable_comercial_id, responsable_tecnico_id, qa_responsable_id")
    .eq("empresa_id", empresaId)
    .eq("id", proyectoId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as {
    titulo?: string | null;
    responsable_comercial_id?: string | null;
    responsable_tecnico_id?: string | null;
    qa_responsable_id?: string | null;
  };
  return {
    titulo: (row.titulo ?? "").trim() || "un proyecto",
    responsable_comercial_id: row.responsable_comercial_id ?? null,
    responsable_tecnico_id: row.responsable_tecnico_id ?? null,
    qa_responsable_id: row.qa_responsable_id ?? null,
  };
}

type UsuarioFlags = {
  id: string;
  rol: string | null;
  es_project_manager: boolean | null;
  es_qa: boolean | null;
};

export async function notificarComentarioProyecto(
  sb: NotifSupabase,
  args: {
    empresaId: string;
    proyectoId: string;
    canal: CanalComentario;
    actorId: string | null;
    actorNombre?: string | null;
    texto: string;
    /**
     * `true` si es un reenvío. Un reenvío es una acción deliberada de "poner esto
     * frente al equipo del canal destino", así que avisa al asignado de ese canal
     * MÁS la supervisión (todos los PMs y QAs), no sólo al asignado. Así el PM se
     * entera cuando le reenvían algo a desarrollo.
     */
    esReenvio?: boolean;
  }
): Promise<void> {
  try {
    const proyecto = await leerProyecto(sb, args.empresaId, args.proyectoId);
    if (!proyecto) return;

    // Una sola consulta al catálogo: de ahí salen PMs, QAs, admins y los flags
    // del autor.
    const catalog = createServiceRoleClient();
    const { data: usuariosData } = await catalog
      .from("usuarios")
      .select("id, rol, es_project_manager, es_qa")
      .eq("empresa_id", args.empresaId);
    const usuarios = (usuariosData ?? []) as UsuarioFlags[];

    const pms = usuarios.filter((u) => u.es_project_manager === true).map((u) => u.id);
    const qas = usuarios.filter((u) => u.es_qa === true).map((u) => u.id);
    const admins = usuarios.filter((u) => esRolAdminEmpresaOGlobal(u.rol)).map((u) => u.id);
    const actor = args.actorId ? usuarios.find((u) => u.id === args.actorId) ?? null : null;

    const actorEsElevado =
      (actor?.es_project_manager === true) ||
      (actor?.es_qa === true) ||
      esRolAdminEmpresaOGlobal(actor?.rol) ||
      proyecto.qa_responsable_id === args.actorId;

    const asignadoDestino =
      args.canal === "comercial"
        ? proyecto.responsable_comercial_id
        : proyecto.responsable_tecnico_id;

    const destinatarios = new Set<string>();
    // Los admins reciben siempre.
    for (const id of admins) destinatarios.add(id);

    if (args.esReenvio) {
      // Reenvío: asignado del canal destino + toda la supervisión (PM + QA).
      if (asignadoDestino) destinatarios.add(asignadoDestino);
      for (const id of pms) destinatarios.add(id);
      for (const id of qas) destinatarios.add(id);
    } else if (actorEsElevado) {
      // PM/QA/admin comenta -> el asignado del canal correspondiente.
      if (asignadoDestino) destinatarios.add(asignadoDestino);
    } else {
      // Comercial/técnico (o cualquiera no elevado) -> PM + QA globales.
      for (const id of pms) destinatarios.add(id);
      for (const id of qas) destinatarios.add(id);
    }

    if (args.actorId) destinatarios.delete(args.actorId);
    if (destinatarios.size === 0) return;

    const autor = (args.actorNombre ?? "").trim() || "Alguien";
    const seccion = args.canal === "comercial" ? "Comercial" : "Desarrollo";
    const extracto = args.texto.trim().replace(/\s+/g, " ").slice(0, 120);
    const titulo = `Comentario · ${proyecto.titulo}`;
    const cuerpo = `${autor} ${args.esReenvio ? "reenvió en" : "en"} ${seccion}: ${extracto}`;

    const filas = [...destinatarios].map((usuarioId) => ({
      empresa_id: args.empresaId,
      usuario_id: usuarioId,
      tipo: "comentario_proyecto",
      titulo,
      cuerpo,
      proyecto_id: args.proyectoId,
      actor_id: args.actorId,
      metadata: { canal: args.canal },
    }));

    const { error } = await sb.from("usuario_notificaciones").insert(filas);
    if (error) {
      console.error("[comentario-notificaciones] no se pudo insertar", error.message);
    }
  } catch (e) {
    console.error("[comentario-notificaciones] no se pudo notificar el comentario", e);
  }
}
