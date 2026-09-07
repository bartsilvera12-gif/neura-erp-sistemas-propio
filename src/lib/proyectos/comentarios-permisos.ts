import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";
import { isErpRolVendedor } from "@/lib/usuarios/erp-rol-normalize";

/**
 * Quién ve/escribe qué canal de comentarios del proyecto.
 *
 * Hay dos canales sobre `proyecto_comentarios.canal`:
 *  - 'comercial'  : comercial/vendedor ↔ Project Manager.
 *  - 'desarrollo' : desarrollador/técnico ↔ PM + QA.
 *
 * Visibilidad:
 *  - Comercial            -> sólo 'comercial'.
 *  - Técnico              -> sólo 'desarrollo'.
 *  - PM, QA y admin       -> ambos.
 *  - Sin encaje claro     -> ambos (supervisor / usuario genérico; decisión de
 *                            negocio: no bloquear a mandos medios).
 *
 * Igual que en QA (ver `qa-permisos.ts`), el filtro vive en el SERVIDOR: la UI
 * esconde la sección que no corresponde, pero es la API la que decide qué
 * comentarios viajan. Si el filtro estuviera sólo en el cliente, un comercial
 * recibiría igual los comentarios de desarrollo en la respuesta.
 *
 * No se usa `usuarios.area` (poco confiable). Los roles funcionales se resuelven
 * por flags globales (`es_qa`, `es_project_manager`, `rol` admin/vendedor) y por
 * ASIGNACIÓN real en el proyecto (`responsable_tecnico_id`,
 * `responsable_comercial_id`, `qa_responsable_id`), como hace `permisoQADe`.
 */

export type CanalComentario = "comercial" | "desarrollo";

export const CANALES_COMENTARIO: readonly CanalComentario[] = ["comercial", "desarrollo"];

export function esCanalComentario(value: unknown): value is CanalComentario {
  return value === "comercial" || value === "desarrollo";
}

export type PermisoComentarios = {
  /** Canales que el usuario puede LEER y ESCRIBIR en este proyecto. */
  canales: CanalComentario[];
  motivo: string;
};

const AMBOS: CanalComentario[] = ["comercial", "desarrollo"];

type UsuarioFlags = {
  rol: string | null;
  es_qa: boolean | null;
  es_project_manager: boolean | null;
};

/**
 * Resuelve los canales de comentarios de un usuario SOBRE UN PROYECTO concreto.
 * El orden importa: los flags globales (QA, PM, admin) ganan sobre la asignación.
 */
/** Asignaciones del proyecto que deciden el acceso a los canales. */
export type AsignacionesProyecto = {
  responsable_tecnico_id: string | null;
  responsable_comercial_id: string | null;
  qa_responsable_id: string | null;
};

/**
 * La regla, en una sola función PURA.
 *
 * Vive separada del acceso a datos porque se necesita en dos lugares: para
 * decidir qué ve UNA persona y para armar la lista de a quién se puede mencionar
 * en un canal, que es la misma pregunta hecha sobre todos. Escribirla dos veces
 * garantizaría que un día digan cosas distintas.
 */
export function canalesParaUsuario(
  usuarioId: string,
  flags: UsuarioFlags,
  proy: AsignacionesProyecto | null
): PermisoComentarios {
  // 1) QA, Project Manager y admin: ambos canales (control y seguimiento).
  if (flags.es_qa === true) return { canales: [...AMBOS], motivo: "es_qa" };
  if (flags.es_project_manager === true) return { canales: [...AMBOS], motivo: "es_project_manager" };
  if (esRolAdminEmpresaOGlobal(flags.rol)) return { canales: [...AMBOS], motivo: "admin" };

  if (!proy) return { canales: [], motivo: "sin_proyecto" };

  // QA asignada a este proyecto aunque no tenga el flag global: ambos.
  if (proy.qa_responsable_id === usuarioId) return { canales: [...AMBOS], motivo: "qa_del_proyecto" };

  // Acumula: alguien puede ser a la vez técnico y comercial del mismo proyecto.
  const canales = new Set<CanalComentario>();
  if (proy.responsable_tecnico_id === usuarioId) canales.add("desarrollo");
  if (proy.responsable_comercial_id === usuarioId || isErpRolVendedor(flags.rol)) {
    canales.add("comercial");
  }

  // Sin encaje (supervisor, usuario genérico, no asignado): ve ambos.
  if (canales.size === 0) return { canales: [...AMBOS], motivo: "fallback_sin_encaje" };

  return { canales: [...canales], motivo: "asignacion" };
}

async function asignacionesDe(
  sb: AppSupabaseClient,
  empresaId: string,
  proyectoId: string
): Promise<AsignacionesProyecto | null> {
  const { data } = await sb
    .from("proyectos")
    .select("responsable_tecnico_id, responsable_comercial_id, qa_responsable_id")
    .eq("empresa_id", empresaId)
    .eq("id", proyectoId)
    .maybeSingle();
  return (data as AsignacionesProyecto | null) ?? null;
}

export async function permisoComentariosDe(
  sb: AppSupabaseClient,
  empresaId: string,
  usuarioId: string,
  proyectoId: string
): Promise<PermisoComentarios> {
  if (!usuarioId || !proyectoId) return { canales: [], motivo: "sin_datos" };

  const catalog = createServiceRoleClient();
  const { data: u } = await catalog
    .from("usuarios")
    .select("rol, es_qa, es_project_manager")
    .eq("empresa_id", empresaId)
    .eq("id", usuarioId)
    .maybeSingle();

  const flags = (u ?? { rol: null, es_qa: null, es_project_manager: null }) as UsuarioFlags;

  // Los tres roles globales no dependen del proyecto: se evita esa consulta.
  if (flags.es_qa === true || flags.es_project_manager === true || esRolAdminEmpresaOGlobal(flags.rol)) {
    return canalesParaUsuario(usuarioId, flags, null);
  }
  return canalesParaUsuario(usuarioId, flags, await asignacionesDe(sb, empresaId, proyectoId));
}

export type CandidatoMencion = {
  id: string;
  nombre: string;
  /** Para mostrar por qué está en la lista: "QA", "Técnico", "PM"… */
  etiqueta: string;
};

/**
 * A quién se puede mencionar en un canal de este proyecto.
 *
 * Sólo entra quien PUEDE VER ese canal: mencionar a alguien que no lo ve sería
 * avisarle de algo que después no puede abrir. Dos consultas fijas, no una por
 * persona.
 */
export async function candidatosMencionDe(
  sb: AppSupabaseClient,
  empresaId: string,
  proyectoId: string,
  canal: CanalComentario
): Promise<CandidatoMencion[]> {
  const catalog = createServiceRoleClient();
  const [{ data: usuarios }, proy] = await Promise.all([
    catalog
      .from("usuarios")
      .select("id, nombre, rol, es_qa, es_project_manager")
      .eq("empresa_id", empresaId)
      .eq("estado", "activo")
      .order("nombre"),
    asignacionesDe(sb, empresaId, proyectoId),
  ]);

  const filas = (usuarios ?? []) as (UsuarioFlags & { id: string; nombre: string | null })[];
  const out: CandidatoMencion[] = [];
  for (const u of filas) {
    const permiso = canalesParaUsuario(u.id, u, proy);
    if (!permiso.canales.includes(canal)) continue;
    const etiqueta =
      u.es_qa === true
        ? "QA"
        : u.es_project_manager === true
          ? "PM"
          : proy?.responsable_tecnico_id === u.id
            ? "Técnico"
            : proy?.responsable_comercial_id === u.id
              ? "Comercial"
              : "";
    out.push({ id: u.id, nombre: (u.nombre ?? "").trim() || "—", etiqueta });
  }
  return out;
}
