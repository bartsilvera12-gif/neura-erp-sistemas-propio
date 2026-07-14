import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { getAuthUserForApiRoute } from "@/lib/auth/get-auth-user-for-api-route";
import { resolveUsuarioErpFromAuthUser } from "@/lib/auth/resolve-usuario-erp";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/super-admin-bootstrap-email";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";

/**
 * Acceso a la API de Plan de Cuentas (catálogo contable, sub-página de Configuración).
 * Config es admin-only: lectura y escritura requieren rol admin/super_admin de la empresa
 * (o email bootstrap). Devuelve la empresa e info de permiso para el resto del handler.
 */
export type PlanCuentasApiAuth =
  | { ok: true; empresaId: string; usuarioCatalogId: string; usuarioEmail: string | null; rol: string | null; canEdit: boolean }
  | { ok: false; status: number; message: string };

export async function requirePlanCuentasApiAccess(request: Request): Promise<PlanCuentasApiAuth> {
  const user = await getAuthUserForApiRoute(request);
  if (!user?.id) {
    return { ok: false, status: 401, message: "No autenticado" };
  }

  const catalog = createServiceRoleClient();
  const usuario = await resolveUsuarioErpFromAuthUser(catalog, user);

  if (!usuario?.empresa_id) {
    if (isBootstrapSuperAdminEmail(user.email)) {
      return { ok: false, status: 403, message: "Seleccioná una empresa para usar Plan de Cuentas" };
    }
    return { ok: false, status: 403, message: "Usuario sin empresa" };
  }

  const rol = (usuario.rol ?? "").trim();
  const esAdmin =
    rol === "super_admin" ||
    isBootstrapSuperAdminEmail(user.email) ||
    esRolAdminEmpresaOGlobal(rol);

  if (!esAdmin) {
    return { ok: false, status: 403, message: "Solo administradores pueden acceder al Plan de Cuentas" };
  }

  return {
    ok: true,
    empresaId: usuario.empresa_id,
    usuarioCatalogId: usuario.id,
    usuarioEmail: user.email ?? null,
    rol: usuario.rol,
    canEdit: true,
  };
}
