import {
  getUsuarioCatalogFromRequestConMotivo,
  type MotivoSinUsuario,
} from "@/lib/auth/usuario-catalog-from-server-session";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { createServiceRoleClientForEmpresa } from "@/lib/supabase/empresa-data-schema";
import { resolveEmpresaDataSchema, type AppSupabaseClient } from "@/lib/supabase/schema";
import { cacheSchemaEmpresa } from "@/lib/auth/cache-sesion-servidor";

/**
 * Falla de sesión con su motivo, para no mandar a "iniciar sesión" a quien ya
 * la inició. Un asesor sin alta en el ERP o sin empresa asignada puede cerrar y
 * abrir sesión mil veces: no es eso lo que le falta.
 */
export class ErrorDeSesion extends Error {
  constructor(readonly motivo: MotivoSinUsuario) {
    super(MENSAJE_POR_MOTIVO[motivo]);
    this.name = "ErrorDeSesion";
  }
}

const MENSAJE_POR_MOTIVO: Record<MotivoSinUsuario, string> = {
  sin_sesion: "Iniciá sesión",
  sin_alta_erp: "Tu usuario no está dado de alta en el ERP. Avisale a soporte.",
  sin_empresa: "Tu usuario no tiene empresa asignada. Avisale a soporte.",
};

/** El texto que ve la persona. Cualquier otra falla sigue pidiendo iniciar sesión. */
export function mensajeDeSesion(e: unknown): string {
  return e instanceof ErrorDeSesion ? e.message : "Iniciá sesión";
}

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
/**
 * `request` es OPCIONAL a propósito: sin él se comporta exactamente como antes (cookies), que
 * es lo que usan las 18 rutas existentes. Pasándolo, además acepta `Authorization: Bearer`,
 * que es lo único que puede mandar un cliente que no es un navegador (la app nativa).
 */
export async function requireEmpresaTenantServiceRole(
  request?: Request | null
): Promise<EmpresaTenantSrContext> {
  const r = await getUsuarioCatalogFromRequestConMotivo(request);
  if (!r.ok) throw new ErrorDeSesion(r.motivo);
  const u = r.usuario;

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
