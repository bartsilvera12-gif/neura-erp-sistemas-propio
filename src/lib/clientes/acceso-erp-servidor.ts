import "server-only";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";

/**
 * Bloqueo de acceso al ERP del cliente por falta de pago (Fase 4).
 *
 * El vínculo cliente→ERP vive en `proyecto_credenciales` (Fase 1): la credencial
 * marcada `es_instancia_erp=true` tiene el `erp_schema` resuelto. El flag se escribe
 * en `<erp_schema>.empresas.acceso_suspendido` con una conexión Postgres directa
 * (cross-schema), y el ERP (middleware) lo lee para mostrar la pantalla de suspensión.
 */

const SCHEMA_RE = /^[a-z][a-z0-9_]{1,62}$/;

export type InstanciaErp = { credId: string; schema: string; coolifyUuid: string | null };

/** Resuelve la instancia de ERP (schema) del cliente desde sus credenciales de proyecto. */
export async function resolverInstanciaErpDeCliente(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  empresaId: string,
  clienteId: string
): Promise<InstanciaErp | null> {
  const { data: proys } = await supabase
    .from("proyectos")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("cliente_id", clienteId);
  const ids = (proys ?? []).map((p: { id: string }) => p.id);
  if (!ids.length) return null;

  const { data: creds } = await supabase
    .from("proyecto_credenciales")
    .select("id, erp_schema, erp_coolify_uuid")
    .eq("empresa_id", empresaId)
    .in("proyecto_id", ids)
    .eq("es_instancia_erp", true)
    .not("erp_schema", "is", null)
    .limit(1);

  const c = creds?.[0];
  if (!c?.erp_schema) return null;
  return { credId: String(c.id), schema: String(c.erp_schema), coolifyUuid: c.erp_coolify_uuid ?? null };
}

/** Error tipado: el schema del ERP todavía no tiene la columna del flag (falta migración 170). */
export class BloqueoNoInstalado extends Error {
  constructor() {
    super("El ERP de este cliente todavía no tiene el bloqueo instalado (falta aplicar la migración en su schema).");
    this.name = "BloqueoNoInstalado";
  }
}

function assertSchema(schema: string): string {
  if (!SCHEMA_RE.test(schema)) throw new Error("schema inválido");
  return schema;
}

/** Lee si el ERP está suspendido (cualquier empresa del schema con el flag en true). */
export async function leerBloqueoErp(schema: string): Promise<boolean> {
  const s = assertSchema(schema);
  const pool = getChatPostgresPool();
  if (!pool) throw new Error("Falta SUPABASE_DB_URL en el servidor para operar el bloqueo.");
  try {
    const r = await pool.query(`select bool_or(acceso_suspendido) as suspendido from "${s}".empresas`);
    return Boolean(r.rows[0]?.suspendido);
  } catch (e: unknown) {
    if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "42703") {
      throw new BloqueoNoInstalado();
    }
    throw e;
  }
}

/** Prende/apaga el flag en TODAS las empresas del schema del ERP (bloquea la instancia completa). */
export async function escribirBloqueoErp(schema: string, suspendido: boolean, motivo: string | null): Promise<void> {
  const s = assertSchema(schema);
  const pool = getChatPostgresPool();
  if (!pool) throw new Error("Falta SUPABASE_DB_URL en el servidor para operar el bloqueo.");
  try {
    await pool.query(
      `update "${s}".empresas
          set acceso_suspendido = $1,
              suspendido_motivo  = $2,
              suspendido_at      = case when $1 then now() else null end`,
      [suspendido, suspendido ? motivo : null]
    );
  } catch (e: unknown) {
    if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "42703") {
      throw new BloqueoNoInstalado();
    }
    throw e;
  }
}
