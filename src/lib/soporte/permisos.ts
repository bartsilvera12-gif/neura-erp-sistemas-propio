/**
 * Quién puede usar el módulo Soporte. ÚNICO lugar donde se decide.
 *
 * Isomórfico a propósito: la misma regla la aplican el menú (cliente), el
 * layout de las páginas (servidor) y cada ruta de la API. Si cada capa tuviera
 * su propia versión, tarde o temprano una quedaría más abierta que las otras.
 *
 * HOY: sólo administradores (super_admin, admin, administrador), con la lógica
 * de roles que ya usa el ERP. No se crea un sistema de roles nuevo.
 *
 * MAÑANA: para abrirlo a ATC, PM, Desarrollo o QA alcanza con sumar acá la
 * condición (por ejemplo `u.es_project_manager`, `u.es_tecnico`, `u.es_qa`),
 * que ya son tildes del catálogo de usuarios. Las capas de arriba no cambian.
 */

import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/super-admin-bootstrap-email";

export type SujetoSoporte = {
  rol: string | null | undefined;
  email?: string | null;
  es_project_manager?: boolean | null;
  es_tecnico?: boolean | null;
  es_qa?: boolean | null;
};

export function puedeUsarSoporte(u: SujetoSoporte | null | undefined): boolean {
  if (!u) return false;
  if (isBootstrapSuperAdminEmail(u.email ?? null)) return true;
  return esRolAdminEmpresaOGlobal(u.rol);
}

/** La configuración (estados, SLA, catálogos) es de administradores siempre. */
export function puedeConfigurarSoporte(u: SujetoSoporte | null | undefined): boolean {
  if (!u) return false;
  if (isBootstrapSuperAdminEmail(u.email ?? null)) return true;
  return esRolAdminEmpresaOGlobal(u.rol);
}

export const SOPORTE_SLUG = "soporte";
