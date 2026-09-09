import { getUsuarioCatalogFromServerCookies } from "@/lib/auth/usuario-catalog-from-server-session";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { createServiceRoleClientForEmpresa } from "@/lib/supabase/empresa-data-schema";
import { resolveEmpresaDataSchema, type AppSupabaseClient } from "@/lib/supabase/schema";
import { cacheSchemaEmpresa } from "@/lib/auth/cache-sesion-servidor";

export type EmpresaTenantSrContext = {
  /** Service role en el schema de datos operativos de la empresa. */
  supabase: AppSupabaseClient;
  /** Service role en `zentra_erp` (consultas catálogo si hiciera falta). */
  catalogSr: AppSupabaseClient;
  empresa_id: string;
  usuario_id: string;
  dataSchema: string;
};

/**
 * Sesión para mutaciones/consultas de tablas tenant (`chat_*`, etc.) sin depender de RLS del JWT.
 * Siempre filtrar por `empresa_id` en las queries.
 */
export async function requireEmpresaTenantServiceRole(): Promise<EmpresaTenantSrContext> {
  const u = await getUsuarioCatalogFromServerCookies();
  if (!u) throw new Error("Usuario no autenticado o sin empresa");

  const catalogSr = createServiceRoleClient();

  // El schema de una empresa no cambia. Preguntarlo en cada acción es un viaje
  // a la base para leer siempre lo mismo.
  let dataSchema = cacheSchemaEmpresa.get(u.empresa_id);
  if (!dataSchema) {
    const { data: empRow } = await catalogSr
      .from("empresas")
      .select("data_schema")
      .eq("id", u.empresa_id)
      .maybeSingle();
    dataSchema = resolveEmpresaDataSchema(
      (empRow as { data_schema?: string | null } | null)?.data_schema
    );
    cacheSchemaEmpresa.set(u.empresa_id, dataSchema);
  }

  const supabase = await createServiceRoleClientForEmpresa(u.empresa_id);

  return {
    supabase,
    catalogSr,
    empresa_id: u.empresa_id,
    usuario_id: u.id,
    dataSchema,
  };
}
