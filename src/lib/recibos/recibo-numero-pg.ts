import "server-only";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";

export { formatReciboNro } from "./recibo-format";

/**
 * Asigna (lazy) el correlativo de recibo a un pago YA confirmado.
 *
 * - El número se asigna la PRIMERA vez que se genera el recibo del pago y queda
 *   persistido en `<schema>.pagos.recibo_nro` → estable en re-generaciones.
 * - Atómico: `SELECT ... FOR UPDATE` del pago + upsert del contador por empresa
 *   (`<schema>.recibo_secuencia`) en una transacción. Sin huecos por doble click.
 *
 * Drift-safe: si el schema del tenant todavía no tiene las columnas/tabla de
 * recibos (o no hay pool), devuelve `null` y el recibo se emite con número
 * provisional en el PDF. Solo el schema de la empresa que pide se ve afectado.
 */
export async function asignarReciboNumero(
  schema: string,
  empresaId: string,
  pagoId: string
): Promise<number | null> {
  const pool = getChatPostgresPool();
  if (!pool) return null;

  let tP: string;
  let tS: string;
  try {
    tP = quoteSchemaTable(schema, "pagos");
    tS = quoteSchemaTable(schema, "recibo_secuencia");
  } catch {
    return null;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const cur = await client.query<{ recibo_nro: number | null }>(
      `SELECT recibo_nro FROM ${tP} WHERE id=$1::uuid AND empresa_id=$2::uuid FOR UPDATE`,
      [pagoId, empresaId]
    );
    if (cur.rowCount === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    const existing = cur.rows[0]?.recibo_nro;
    if (existing != null) {
      await client.query("COMMIT");
      return Number(existing);
    }

    const seq = await client.query<{ ultimo: number }>(
      `INSERT INTO ${tS} (empresa_id, ultimo) VALUES ($1::uuid, 1)
       ON CONFLICT (empresa_id) DO UPDATE SET ultimo = ${tS}.ultimo + 1, updated_at = now()
       RETURNING ultimo`,
      [empresaId]
    );
    const nro = Number(seq.rows[0]?.ultimo);

    await client.query(
      `UPDATE ${tP} SET recibo_nro=$1, recibo_emitido_at=now()
       WHERE id=$2::uuid AND empresa_id=$3::uuid`,
      [nro, pagoId, empresaId]
    );

    await client.query("COMMIT");
    return nro;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    console.warn("[recibos] asignarReciboNumero fallo (drift-safe → provisional)", {
      schema,
      pagoId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  } finally {
    client.release();
  }
}
