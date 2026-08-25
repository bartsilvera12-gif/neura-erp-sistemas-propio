import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { getAuthUserForApiRoute } from "@/lib/auth/get-auth-user-for-api-route";
import { resolveUsuarioErpFromAuthUser } from "@/lib/auth/resolve-usuario-erp";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/super-admin-bootstrap-email";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";
import { normalizeRolAyuda } from "@/lib/ayuda/ayuda";

/**
 * Acceso a la API de Ayuda en línea.
 *
 * A diferencia del resto de Configuración, la LECTURA es para cualquier usuario
 * con sesión (el asesor es justamente el destinatario). Solo la escritura queda
 * reservada a admin: `esAdmin` decide, y cada endpoint aplica lo que corresponde.
 */
export type AyudaApiAuth =
  | {
      ok: true;
      empresaId: string;
      usuarioCatalogId: string | null;
      usuarioEmail: string | null;
      /** Rol normalizado (minúsculas) para cruzar con `roles_visibles`. */
      rol: string;
      esAdmin: boolean;
    }
  | { ok: false; status: number; message: string };

export async function requireAyudaApiAccess(request: Request): Promise<AyudaApiAuth> {
  const user = await getAuthUserForApiRoute(request);
  if (!user?.id) {
    return { ok: false, status: 401, message: "No autenticado" };
  }

  const catalog = createServiceRoleClient();
  const usuario = await resolveUsuarioErpFromAuthUser(catalog, user);

  if (!usuario?.empresa_id) {
    if (isBootstrapSuperAdminEmail(user.email)) {
      return { ok: false, status: 403, message: "Seleccioná una empresa para usar la Ayuda en línea" };
    }
    return { ok: false, status: 403, message: "Usuario sin empresa" };
  }

  const rol = normalizeRolAyuda(usuario.rol);
  const esAdmin =
    rol === "super_admin" ||
    isBootstrapSuperAdminEmail(user.email) ||
    esRolAdminEmpresaOGlobal(usuario.rol);

  return {
    ok: true,
    empresaId: usuario.empresa_id,
    usuarioCatalogId: usuario.id ?? null,
    usuarioEmail: user.email ?? null,
    rol,
    esAdmin,
  };
}

/** Igual que `requireAyudaApiAccess` pero corta con 403 si no es admin (endpoints de edición). */
export async function requireAyudaAdminAccess(request: Request): Promise<AyudaApiAuth> {
  const auth = await requireAyudaApiAccess(request);
  if (!auth.ok) return auth;
  if (!auth.esAdmin) {
    return { ok: false, status: 403, message: "Solo administradores pueden editar la Ayuda en línea" };
  }
  return auth;
}
