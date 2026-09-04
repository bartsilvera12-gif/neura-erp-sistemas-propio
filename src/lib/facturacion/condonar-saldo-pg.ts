import "server-only";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { getConfigContable, generarAsientoEnTx, ContabilidadError, type AsientoLineaInput } from "@/lib/contabilidad/asientos-pg";

/**
 * Condonación / incobrable del SALDO restante de una factura parcialmente pagada.
 * Atómico: pone el saldo en 0, marca la factura Pagada con etiqueta de condonación, y —solo si
 * la factura estaba contabilizada— genera el asiento (Debe Descuentos/Incobrables / Haber Clientes)
 * por el saldo. NO toca los pagos ya registrados. Queda auditado.
 */

export class CondonarError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

export type CondonarTipo = "condonado" | "incobrable";
export interface CondonarResult { saldo_condonado: number; asiento_id: string | null; contabilizado: boolean }

function hoyPY(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export async function condonarSaldoFactura(
  schemaRaw: string,
  empresaId: string,
  facturaId: string,
  tipo: CondonarTipo,
  motivo: string,
  userId: string | null
): Promise<CondonarResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  if (tipo !== "condonado" && tipo !== "incobrable") throw new CondonarError("Tipo inválido (condonado | incobrable).");
  if (!motivo?.trim()) throw new CondonarError("Indicá el motivo de la condonación.");
  const pool = getChatPostgresPool();
  if (!pool) throw new CondonarError("Conexión no disponible.", 500);
  const tF = quoteSchemaTable(schema, "facturas");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ estado: string; estado_contable: string; saldo: string; moneda: string; numero_factura: string; condonacion_tipo: string | null }>(
      `SELECT estado, estado_contable, saldo, moneda, numero_factura, condonacion_tipo
         FROM ${tF} WHERE id=$1::uuid AND empresa_id=$2::uuid FOR UPDATE`,
      [facturaId, empresaId]
    );
    const f = rows[0];
    if (!f) throw new CondonarError("Factura no encontrada.", 404);
    if (["Anulado", "Corregida NC"].includes(f.estado)) throw new CondonarError(`La factura está ${f.estado}; no se puede condonar.`, 409);
    if (f.condonacion_tipo) throw new CondonarError("El saldo de esta factura ya fue condonado.", 409);
    const saldo = Math.round(Number(f.saldo) || 0);
    if (saldo <= 0) throw new CondonarError("La factura no tiene saldo pendiente para condonar.", 409);

    const contabilizado = f.estado_contable === "contabilizado";
    let asientoId: string | null = null;

    if (contabilizado) {
      const config = await getConfigContable(schema, empresaId);
      const ctaDesc = config?.cuenta_descuentos_incobrables_id;
      const ctaClientes = config?.cuenta_clientes_id;
      if (!ctaDesc) throw new ContabilidadError("Configurá la cuenta de Descuentos/Incobrables en Configuración Contable.");
      if (!ctaClientes) throw new ContabilidadError("Configurá la cuenta general de Clientes (CxC) en Configuración Contable.");
      const etiqueta = tipo === "incobrable" ? "Incobrable" : "Condonación";
      const lineas: AsientoLineaInput[] = [
        { cuenta_contable_id: ctaDesc, descripcion: `${etiqueta} saldo ${f.numero_factura}`, debe: saldo, haber: 0, documento_tipo: "condonacion", documento_id: facturaId },
        { cuenta_contable_id: ctaClientes, descripcion: "Clientes / CxC", debe: 0, haber: saldo, documento_tipo: "condonacion", documento_id: facturaId },
      ];
      const asiento = await generarAsientoEnTx(client, schema, empresaId, {
        origen_tipo: "condonacion", origen_id: facturaId, evento_origen: `condonacion_${tipo}`,
        fecha_contable: hoyPY(), glosa: `${etiqueta} de saldo — factura ${f.numero_factura}`,
        moneda: f.moneda === "USD" ? "USD" : "PYG", tipo_cambio: 1, lineas, createdBy: userId,
      });
      asientoId = asiento.id;
    }

    await client.query(
      `UPDATE ${tF} SET saldo=0, estado='Pagado', condonacion_tipo=$3, condonacion_motivo=$4,
             condonado_by=$5::uuid, condonado_at=now(), condonacion_asiento_id=$6::uuid, updated_at=now()
        WHERE id=$1::uuid AND empresa_id=$2::uuid`,
      [facturaId, empresaId, tipo, motivo.trim(), userId, asientoId]
    );

    await client.query("COMMIT");
    return { saldo_condonado: saldo, asiento_id: asientoId, contabilizado };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => null);
    throw e;
  } finally {
    client.release();
  }
}
