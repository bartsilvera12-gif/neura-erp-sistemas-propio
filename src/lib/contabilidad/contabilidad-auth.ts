import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { getAuthUserForApiRoute } from "@/lib/auth/get-auth-user-for-api-route";
import { resolveUsuarioErpFromAuthUser } from "@/lib/auth/resolve-usuario-erp";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/super-admin-bootstrap-email";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";
import { resolveEffectiveModules } from "@/lib/modulos/resolve-effective-modules";

/**
 * Acceso a las APIs de Contabilidad (Gastos y Servicios, Libro de Compras).
 * Permitido para: super_admin, admin de empresa (o email bootstrap) o cualquier
 * usuario con el módulo/permiso explícito `contabilidad`. Devuelve 403 en el resto.
 */
export type ContabilidadApiAuth =
  | { ok: true; empresaId: string; usuarioCatalogId: string; usuarioEmail: string | null; rol: string | null }
  | { ok: false; status: number; message: string };

/**
 * Guard genérico: admin/super_admin/bootstrap, o cualquiera de los módulos
 * `allowedSlugs`. `label` se usa en los mensajes 403.
 */
export async function requireModulosApiAccess(request: Request, allowedSlugs: string[], label: string): Promise<ContabilidadApiAuth> {
  const user = await getAuthUserForApiRoute(request);
  if (!user?.id) {
    return { ok: false, status: 401, message: "No autenticado" };
  }

  const catalog = createServiceRoleClient();
  const usuario = await resolveUsuarioErpFromAuthUser(catalog, user);

  if (!usuario?.empresa_id) {
    if (isBootstrapSuperAdminEmail(user.email)) {
      return { ok: false, status: 403, message: `Seleccioná una empresa para usar ${label}` };
    }
    return { ok: false, status: 403, message: "Usuario sin empresa" };
  }

  const rol = (usuario.rol ?? "").trim();
  const ok = {
    ok: true as const,
    empresaId: usuario.empresa_id,
    usuarioCatalogId: usuario.id,
    usuarioEmail: user.email ?? null,
    rol: usuario.rol,
  };

  // Admin / super_admin / bootstrap → acceso directo.
  if (rol === "super_admin" || isBootstrapSuperAdminEmail(user.email) || esRolAdminEmpresaOGlobal(rol)) {
    return ok;
  }

  const modulos = await resolveEffectiveModules(catalog, {
    id: usuario.id,
    empresa_id: usuario.empresa_id,
    rol: usuario.rol,
  });
  const slugs = new Set(modulos.map((m) => (m.slug ?? "").trim().toLowerCase()));
  if (allowedSlugs.some((s) => slugs.has(s))) {
    return ok;
  }

  return { ok: false, status: 403, message: `Sin permiso de ${label}` };
}

export function requireContabilidadApiAccess(request: Request): Promise<ContabilidadApiAuth> {
  return requireModulosApiAccess(request, ["contabilidad"], "Contabilidad");
}

/** Acceso a Conciliación bancaria / cobros: Cobranzas o Contabilidad (o admin). */
export function requireCobranzasApiAccess(request: Request): Promise<ContabilidadApiAuth> {
  return requireModulosApiAccess(request, ["contabilidad", "cobranzas", "pagos"], "Cobranzas");
}
