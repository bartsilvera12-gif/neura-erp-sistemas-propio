import { createClient } from "@supabase/supabase-js";
import {
  SUPABASE_APP_SCHEMA,
  resolveEmpresaDataSchema,
  type AppSupabaseClient,
  supabaseServiceRoleClientOptions,
} from "@/lib/supabase/schema";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";

/**
 * Cache en memoria del `data_schema` por empresa. El schema de un tenant es
 * prácticamente estático (sólo cambia al aprovisionar la empresa), pero esta
 * función se llamaba en CADA request de API (varias veces por carga de tablero),
 * pegándole a `empresas` cada vez. Con un TTL corto, se resuelve una vez por
 * instancia caliente y el resto son lecturas de memoria. La staleness máxima es
 * el TTL, aceptable para un dato que casi nunca cambia.
 */
const schemaCache = new Map<string, { at: number; schema: string }>();
const SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Lee `empresas.data_schema` (catálogo en zentra_erp).
 * NULL o vacío → datos de negocio en plantilla `zentra_erp` (empresas legadas).
 * Valor `erp_*` → schema tenant clonado desde zentra_erp.
 */
export async function fetchDataSchemaForEmpresaId(empresaId: string): Promise<string> {
  const cached = schemaCache.get(empresaId);
  if (cached && Date.now() - cached.at < SCHEMA_CACHE_TTL_MS) return cached.schema;

  const catalog = createServiceRoleClient();
  const { data, error } = await catalog
    .from("empresas")
    .select("data_schema")
    .eq("id", empresaId)
    .maybeSingle();

  if (error) {
    console.error("[empresa-data-schema] fetch:", error.message);
    // Ante un error transitorio, se reusa lo último cacheado si hay; no se
    // cachea el fallback para reintentar en la próxima.
    return cached?.schema ?? SUPABASE_APP_SCHEMA;
  }

  const schema = resolveEmpresaDataSchema((data as { data_schema?: string | null } | null)?.data_schema);
  schemaCache.set(empresaId, { at: Date.now(), schema });
  return schema;
}

/** Service role apuntando al esquema de datos operativos de la empresa (chat/omnicanal). */
export function createServiceRoleClientWithDbSchema(schema: string): AppSupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema },
  }) as AppSupabaseClient;
}

/** Resuelve cliente service role: tenant si `data_schema`, si no catálogo zentra_erp. */
export async function createServiceRoleClientForEmpresa(empresaId: string): Promise<AppSupabaseClient> {
  const schema = await fetchDataSchemaForEmpresaId(empresaId);
  if (schema === SUPABASE_APP_SCHEMA) {
    return createServiceRoleClient();
  }
  return createServiceRoleClientWithDbSchema(schema);
}
