import "server-only";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

export interface CuentaContableOpcion {
  id: string;
  cuenta: string;
  denominacion: string;
}

/**
 * Cuentas seleccionables para asociar a una compra: SOLO activas y asentables
 * (imputables). No incluye agrupadoras ni cuentas inactivas. Empresa-scoped.
 */
export async function listCuentasContablesOpciones(
  schemaRaw: string,
  empresaId: string
): Promise<CuentaContableOpcion[]> {
  const pool = getChatPostgresPool();
  if (!pool) throw new Error("Pool no disponible.");
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "plan_cuentas");
  const { rows } = await pool.query<CuentaContableOpcion>(
    `SELECT id, cuenta, denominacion
       FROM ${t}
      WHERE empresa_id = $1::uuid AND activo = true AND asentable = true
      ORDER BY cuenta ASC`,
    [empresaId]
  );
  return rows;
}
