import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { getAuthUserForApiRoute } from "@/lib/auth/get-auth-user-for-api-route";
import { resolveUsuarioErpFromAuthUser } from "@/lib/auth/resolve-usuario-erp";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/super-admin-bootstrap-email";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";

/**
 * Acceso a las guardias, en dos niveles.
 *
 * LEER lo puede hacer cualquiera de la empresa, sin módulo de por medio: el
 * sentido de la pantalla es que un sábado a la noche cualquiera sepa a quién
 * llamar. Pedir un módulo para eso sería poner una puerta delante de un cartel.
 *
 * ASIGNAR es de administradores. Es una decisión organizativa, no una tarea
 * operativa, y si la puede cambiar cualquiera deja de ser confiable.
 */

export type GuardiasAuthOk = {
  ok: true;
  empresaId: string;
  usuarioCatalogId: string;
  rol: string | null;
  esAdmin: boolean;
};

export type GuardiasAuth = GuardiasAuthOk | { ok: false; status: number; message: string };

export async function requireGuardiasAcceso(request: Request): Promise<GuardiasAuth> {
  const user = await getAuthUserForApiRoute(request);
  if (!user?.id) return { ok: false, status: 401, message: "No autenticado" };

  const catalog = createServiceRoleClient();
  const usuario = await resolveUsuarioErpFromAuthUser(catalog, user);
  const bootstrapSuperAdmin = isBootstrapSuperAdminEmail(user.email);

  if (!usuario?.empresa_id) {
    return { ok: false, status: 403, message: "Usuario sin empresa" };
  }

  const rol = (usuario.rol ?? "").trim();
  return {
    ok: true,
    empresaId: usuario.empresa_id,
    usuarioCatalogId: usuario.id,
    rol,
    esAdmin: bootstrapSuperAdmin || esRolAdminEmpresaOGlobal(rol),
  };
}
