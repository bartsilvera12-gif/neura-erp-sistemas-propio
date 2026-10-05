import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { getAuthUserForApiRoute } from "@/lib/auth/get-auth-user-for-api-route";
import { resolveUsuarioErpFromAuthUser } from "@/lib/auth/resolve-usuario-erp";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/super-admin-bootstrap-email";
import { tieneAccesoMovilEspecial } from "@/lib/auth/acceso-movil-especial";
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

export function puedeEliminarProyectos(auth: ProyectosApiAuthOk): boolean {
  return auth.bootstrapSuperAdmin || esRolAdminEmpresaOGlobal(auth.rol);
}

export type AsignacionFlujo = {
  responsable_tecnico_id?: string | null;
  project_manager_id?: string | null;
  qa_responsable_id?: string | null;
};

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
  if (u.es_project_manager === true || u.es_qa === true || u.es_tecnico === true) return false;
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
  const accesoMovilEspecial = tieneAccesoMovilEspecial(user.email);

  if (!usuario?.empresa_id) {
    if (bootstrapSuperAdmin) {
      return { ok: false, status: 403, message: "Seleccioná una empresa para usar Proyectos" };
    }
    return { ok: false, status: 403, message: "Usuario sin empresa" };
  }

  const rol = (usuario.rol ?? "").trim();
  if (rol === "super_admin" || bootstrapSuperAdmin || accesoMovilEspecial) {
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
