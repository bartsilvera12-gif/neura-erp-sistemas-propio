import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Quién ve qué del módulo de QA.
 *
 * Hay dos vistas de la MISMA incidencia:
 *
 *  - `qa`: la de QA y Project Manager. Incluye el panel de Seguimiento interno
 *    (hilo privado PM↔QA) y el veredicto.
 *  - `desarrollo`: la del técnico. Misma incidencia y misma conversación
 *    técnica, SIN el hilo interno. Su acción es enviar a revisión, no resolver.
 *
 * Y un tercer caso: `null` = no ve QA (comercial y cualquiera ajeno al
 * proyecto).
 *
 * POR QUÉ NO SE USA `usuarios.area`
 * ---------------------------------
 * `area` está cargada de forma poco confiable: hay gente que desarrolla
 * marcada como "soporte". Usarla como límite de permisos dejaría técnicos
 * afuera o —peor— comerciales adentro. El acceso de desarrollo se decide por
 * ASIGNACIÓN REAL en ese proyecto (`responsable_tecnico_id` / `qa_responsable_id`),
 * que es un dato que el sistema mantiene solo y no depende de que alguien
 * cargue bien un campo.
 *
 * El filtro vive en el servidor a propósito: la UI esconde el panel interno,
 * pero quien decide qué comentarios se envían es la API. Si el filtro estuviera
 * sólo en el cliente, el hilo privado viajaría igual en la respuesta.
 */

export type VistaQA = "qa" | "desarrollo";

export type PermisoQA = {
  /** Vista que corresponde, o `null` si no tiene acceso al módulo de QA. */
  vista: VistaQA | null;
  /** Puede leer y escribir el hilo Seguimiento interno (PM ↔ QA). */
  puedeVerInterno: boolean;
  /** Por qué se resolvió así. Para depurar y para el mensaje de "sin acceso". */
  motivo: string;
};

const SIN_ACCESO: PermisoQA = {
  vista: null,
  puedeVerInterno: false,
  motivo: "sin_acceso",
};

type UsuarioFlags = {
  rol: string | null;
  es_qa: boolean | null;
  es_project_manager: boolean | null;
};

/** Roles que ven todo, para control y seguimiento. */
function esAdmin(u: UsuarioFlags): boolean {
  const rol = (u.rol ?? "").trim().toLowerCase();
  return rol === "administrador" || rol === "super_admin";
}

/**
 * Resuelve el permiso de QA de un usuario SOBRE UN PROYECTO concreto.
 *
 * El orden importa: los flags globales (QA, PM, admin) ganan sobre la
 * asignación, porque una QA sigue siendo QA aunque ese proyecto no sea suyo.
 */
export async function permisoQADe(
  sb: AppSupabaseClient,
  empresaId: string,
  usuarioId: string,
  proyectoId: string
): Promise<PermisoQA> {
  if (!usuarioId || !proyectoId) return SIN_ACCESO;

  const catalog = createServiceRoleClient();
  const { data: u } = await catalog
    .from("usuarios")
    .select("rol, es_qa, es_project_manager")
    .eq("empresa_id", empresaId)
    .eq("id", usuarioId)
    .maybeSingle();

  const flags = (u ?? { rol: null, es_qa: null, es_project_manager: null }) as UsuarioFlags;

  // 1) QA, Project Manager y admin: vista completa, con el hilo interno.
  //    El admin entra por control y seguimiento, tal como se pidió.
  if (flags.es_qa === true) return { vista: "qa", puedeVerInterno: true, motivo: "es_qa" };
  if (flags.es_project_manager === true) {
    return { vista: "qa", puedeVerInterno: true, motivo: "es_project_manager" };
  }
  if (esAdmin(flags)) return { vista: "qa", puedeVerInterno: true, motivo: "admin" };

  // 2) El resto se decide por la asignación en ESE proyecto.
  const { data: p } = await sb
    .from("proyectos")
    .select("responsable_tecnico_id, responsable_comercial_id, qa_responsable_id")
    .eq("empresa_id", empresaId)
    .eq("id", proyectoId)
    .maybeSingle();

  if (!p) return SIN_ACCESO;
  const proy = p as {
    responsable_tecnico_id: string | null;
    responsable_comercial_id: string | null;
    qa_responsable_id: string | null;
  };

  // QA asignada a este proyecto aunque no tenga el flag global.
  if (proy.qa_responsable_id === usuarioId) {
    return { vista: "qa", puedeVerInterno: true, motivo: "qa_del_proyecto" };
  }

  // Técnico del proyecto: vista de desarrollo, sin el hilo interno.
  if (proy.responsable_tecnico_id === usuarioId) {
    return { vista: "desarrollo", puedeVerInterno: false, motivo: "tecnico_del_proyecto" };
  }

  // Comercial del proyecto: explícitamente SIN acceso a QA. Se distingue del
  // "sin_acceso" genérico para poder mostrarle un mensaje que explique por qué.
  if (proy.responsable_comercial_id === usuarioId) {
    return { vista: null, puedeVerInterno: false, motivo: "comercial_sin_acceso_qa" };
  }

  return SIN_ACCESO;
}

/**
 * Orígenes de comentario que puede LEER una vista.
 *
 * 'interno' sólo sale para quien tiene el permiso: es la garantía de que el
 * hilo privado no viaja al cliente de Desarrollo.
 */
export function origenesVisibles(permiso: PermisoQA): string[] {
  return permiso.puedeVerInterno ? ["qa", "tecnico", "interno"] : ["qa", "tecnico"];
}
