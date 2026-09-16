/**
 * Quién puede usar el módulo Soporte. ÚNICO lugar donde se decide.
 *
 * Isomórfico a propósito: la misma regla la aplican el menú (cliente), el
 * layout de las páginas (servidor) y cada ruta de la API. Si cada capa tuviera
 * su propia versión, tarde o temprano una quedaría más abierta que las otras.
 *
 * HOY: administradores (super_admin, admin, administrador), con la lógica de
 * roles que ya usa el ERP, y además quien tenga el módulo `soporte` asignado a
 * mano en `usuario_modulos` (`concedido`). Tiene que ser una fila EXPLÍCITA: la
 * retrocompatibilidad de "sin filas ve todo" no cuenta, o se abriría para
 * cualquiera sin módulos configurados.
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
  /** Fila explícita del módulo `soporte` en `usuario_modulos`. */
  concedido?: boolean | null;
};

export function puedeUsarSoporte(u: SujetoSoporte | null | undefined): boolean {
  if (!u) return false;
  if (isBootstrapSuperAdminEmail(u.email ?? null)) return true;
  return esRolAdminEmpresaOGlobal(u.rol) || u.concedido === true;
}

/**
 * Equipo operativo de Soporte: PM, QA y Desarrollo que no son administradores.
 * Trabajan los tickets, pero no ven el Dashboard ni la Configuración.
 */
export function esEquipoOperativoSoporte(u: SujetoSoporte | null | undefined): boolean {
  if (!u) return false;
  if (isBootstrapSuperAdminEmail(u.email ?? null) || esRolAdminEmpresaOGlobal(u.rol)) return false;
  return u.es_project_manager === true || u.es_qa === true || u.es_tecnico === true;
}

/** El Dashboard de Soporte: todos los que usan el módulo menos el equipo operativo. */
export function puedeVerDashboardSoporte(u: SujetoSoporte | null | undefined): boolean {
  return puedeUsarSoporte(u) && !esEquipoOperativoSoporte(u);
}

/** La configuración (estados, SLA, catálogos): administradores y quien tenga el módulo concedido, salvo el equipo operativo. */
export function puedeConfigurarSoporte(u: SujetoSoporte | null | undefined): boolean {
  if (!u) return false;
  if (isBootstrapSuperAdminEmail(u.email ?? null)) return true;
  if (esRolAdminEmpresaOGlobal(u.rol)) return true;
  return u.concedido === true && !esEquipoOperativoSoporte(u);
}

export const SOPORTE_SLUG = "soporte";
