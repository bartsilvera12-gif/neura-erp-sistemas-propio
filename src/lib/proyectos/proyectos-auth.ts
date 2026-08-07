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
