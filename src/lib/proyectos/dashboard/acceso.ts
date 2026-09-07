import "server-only";

/**
 * Quién entra a cada dashboard.
 *
 * El control vive en el SERVIDOR y no en el menú: esconder la pestaña no es un
 * permiso — cualquiera puede llamar a la API a mano. Mismo criterio que ya usa
 * `/api/project-managers`.
 *
 * Las banderas salen del catálogo (`usuarios.es_project_manager` / `es_qa`), no
 * de `usuarios.area`, que está cargada de forma poco confiable.
 */

import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";
import type { ProyectosApiAuthOk } from "@/lib/proyectos/proyectos-auth";

export type PerfilDashboard = {
  esAdmin: boolean;
  esPm: boolean;
  esQa: boolean;
  usuarioId: string;
};

export async function resolverPerfilDashboard(auth: ProyectosApiAuthOk): Promise<PerfilDashboard> {
  const esAdmin = auth.bootstrapSuperAdmin || esRolAdminEmpresaOGlobal(auth.rol);
  const catalogo = createServiceRoleClient();
  const { data } = await catalogo
    .from("usuarios")
    .select("es_project_manager, es_qa")
    .eq("id", auth.usuarioCatalogId)
    .maybeSingle();
  const u = (data ?? {}) as { es_project_manager?: boolean | null; es_qa?: boolean | null };
  return {
    esAdmin,
    esPm: u.es_project_manager === true,
    esQa: u.es_qa === true,
    usuarioId: auth.usuarioCatalogId,
  };
}

/** El Ejecutivo es lectura de Directorio: administración y project managers. */
export function puedeVerEjecutivo(p: PerfilDashboard): boolean {
  return p.esAdmin || p.esPm;
}

/** El PM es la pantalla de trabajo del PM; el admin entra para supervisar. */
export function puedeVerPm(p: PerfilDashboard): boolean {
  return p.esAdmin || p.esPm;
}
