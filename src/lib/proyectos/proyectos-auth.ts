import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { getAuthUserForApiRoute } from "@/lib/auth/get-auth-user-for-api-route";
import { resolveUsuarioErpFromAuthUser } from "@/lib/auth/resolve-usuario-erp";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/super-admin-bootstrap-email";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";
import { resolveEffectiveModules } from "@/lib/modulos/resolve-effective-modules";

export type ProyectosApiAuthOk = {
  ok: true;
  empresaId: string;
  usuarioCatalogId: string;
  rol: string | null;
  /** El email está en la lista de bootstrap de super admin, más allá del rol del catálogo. */
  bootstrapSuperAdmin: boolean;
};

export type ProyectosApiAuth =
  | ProyectosApiAuthOk
  | { ok: false; status: number; message: string };

/**
 * Quién puede eliminar un proyecto definitivamente: admin de empresa, super admin
 * (en cualquiera de sus variantes históricas de rol) o el super admin de bootstrap.
 * Los demás roles tienen el soft delete (`PATCH { archivado: true }`).
 */
export function puedeEliminarProyectos(auth: ProyectosApiAuthOk): boolean {
  return auth.bootstrapSuperAdmin || esRolAdminEmpresaOGlobal(auth.rol);
}

/** Asignaciones de un proyecto que habilitan a manejar su flujo. */
export type AsignacionFlujo = {
  responsable_tecnico_id?: string | null;
  project_manager_id?: string | null;
  qa_responsable_id?: string | null;
};

/**
 * ¿El usuario es SOLO LECTURA del flujo del proyecto? (Tipo, Estado, Sub-etapa,
 * Eliminar.) El comercial —y cualquier usuario que no sea del equipo— abre la
 * ficha para coordinar (datos, comentarios, archivos) pero no maneja el tablero.
 *
 * El flujo lo maneja el EQUIPO del proyecto: admin, Project Manager, QA o técnico,
 * ya sea por flag global (`es_project_manager`/`es_qa`/`es_tecnico`) o por estar
 * ASIGNADO a ese proyecto (responsable técnico / PM / QA). Todo el resto es solo
 * lectura.
 *
 * Clave: NO se filtra por `usuarios.area` (poco confiable) ni por el rol string
 * suelto. Un comercial real suele figurar con rol "usuario" y área "ventas"
 * (p. ej. Marco), así que confiar en eso lo dejaría afuera. Se decide por función
 * real (flags + asignación): si no sos del equipo técnico/gestión, no tocás el flujo.
 */
export async function esComercialSoloLectura(
  auth: ProyectosApiAuthOk,
  proyecto?: AsignacionFlujo | null
): Promise<boolean> {
  if (auth.bootstrapSuperAdmin || esRolAdminEmpresaOGlobal(auth.rol)) return false;
  const catalog = createServiceRoleClient();
  const { data } = await catalog
    .from("usuarios")
    .select("es_project_manager, es_qa, es_tecnico")
    .eq("id", auth.usuarioCatalogId)
    .maybeSingle();
  const u = (data ?? {}) as {
    es_project_manager?: boolean | null;
    es_qa?: boolean | null;
    es_tecnico?: boolean | null;
  };
  // Equipo técnico / gestión por flag global → maneja el flujo.
  if (u.es_project_manager === true || u.es_qa === true || u.es_tecnico === true) return false;
  // O asignado a ESTE proyecto como técnico / PM / QA → también.
  const uid = auth.usuarioCatalogId;
  if (
    proyecto &&
    (proyecto.responsable_tecnico_id === uid ||
      proyecto.project_manager_id === uid ||
      proyecto.qa_responsable_id === uid)
  ) {
    return false;
  }
  return true;
}

export async function requireProyectosApiAccess(request: Request): Promise<ProyectosApiAuth> {
  const user = await getAuthUserForApiRoute(request);
  if (!user?.id) {
    return { ok: false, status: 401, message: "No autenticado" };
  }

  const catalog = createServiceRoleClient();
  const usuario = await resolveUsuarioErpFromAuthUser(catalog, user);

  const bootstrapSuperAdmin = isBootstrapSuperAdminEmail(user.email);

  if (!usuario?.empresa_id) {
    if (bootstrapSuperAdmin) {
      return { ok: false, status: 403, message: "Seleccioná una empresa para usar Proyectos" };
    }
    return { ok: false, status: 403, message: "Usuario sin empresa" };
  }

  const rol = (usuario.rol ?? "").trim();
  if (rol === "super_admin" || bootstrapSuperAdmin) {
    return {
      ok: true,
      empresaId: usuario.empresa_id,
      usuarioCatalogId: usuario.id,
      rol,
      bootstrapSuperAdmin,
    };
  }

  const modulos = await resolveEffectiveModules(catalog, {
    id: usuario.id,
    empresa_id: usuario.empresa_id,
    rol: usuario.rol,
  });
  const slugs = new Set(modulos.map((m) => (m.slug ?? "").trim().toLowerCase()));
  if (!slugs.has("proyectos")) {
    return { ok: false, status: 403, message: "Sin acceso al módulo Proyectos" };
  }

  return {
    ok: true,
    empresaId: usuario.empresa_id,
    usuarioCatalogId: usuario.id,
    rol: usuario.rol,
    bootstrapSuperAdmin,
  };
}
