import "server-only";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

export type OrigenTipo = "gasto_servicio" | "compra" | "reversion" | "pago_proveedor";

export class ContabilidadError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

export interface AsientoLineaInput {
  cuenta_contable_id: string;
  proveedor_id?: string | null;
  descripcion?: string | null;
  debe: number;
  haber: number;
  documento_tipo?: string | null;
  documento_id?: string | null;
}

export interface GenerarAsientoInput {
  origen_tipo: OrigenTipo;
  origen_id: string;
  evento_origen: string;
  fecha_contable: string;
  glosa: string;
  moneda?: string;
  tipo_cambio?: number;
  lineas: AsientoLineaInput[];
  createdBy: string | null;
  asiento_original_id?: string | null;
}

export interface AsientoRef { id: string; numero: string }

export interface ConfigContable {
  empresa_id: string;
  cuenta_iva_credito_5_id: string | null;
  cuenta_iva_credito_10_id: string | null;
  cuenta_proveedores_id: string | null;
  cuenta_caja_id: string | null;
  cuenta_banco_id: string | null;
}

/** Lee la configuración contable de la empresa (o null si no está configurada). */
export async function getConfigContable(schemaRaw: string, empresaId: string): Promise<ConfigContable | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "configuracion_contable");
  const { rows } = await pool().query<ConfigContable>(
    `SELECT empresa_id, cuenta_iva_credito_5_id, cuenta_iva_credito_10_id, cuenta_proveedores_id, cuenta_caja_id, cuenta_banco_id
       FROM ${t} WHERE empresa_id = $1::uuid`,
    [empresaId]
  );
  return rows[0] ?? null;
}

type Client = import("pg").PoolClient;

/** Verifica que la fecha caiga en un período abierto (auto-crea el mes como 'abierto' si no existe). */
export async function assertPeriodoAbierto(client: Client, schema: string, empresaId: string, fecha: string): Promise<void> {
  const t = quoteSchemaTable(schema, "periodos_contables");
  const [ys, ms] = fecha.split("-");
  const anio = Number(ys), mes = Number(ms);
  if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw new ContabilidadError("Fecha contable inválida.");
  }
  const desde = `${anio}-${String(mes).padStart(2, "0")}-01`;
  const hastaDay = new Date(anio, mes, 0).getDate();
  const hasta = `${anio}-${String(mes).padStart(2, "0")}-${String(hastaDay).padStart(2, "0")}`;
  await client.query(
    `INSERT INTO ${t} (empresa_id, anio, mes, fecha_desde, fecha_hasta, estado)
     VALUES ($1::uuid, $2, $3, $4::date, $5::date, 'abierto') ON CONFLICT (empresa_id, anio, mes) DO NOTHING`,
    [empresaId, anio, mes, desde, hasta]
  );
  const { rows } = await client.query<{ estado: string }>(
    `SELECT estado FROM ${t} WHERE empresa_id = $1::uuid AND anio = $2 AND mes = $3`,
    [empresaId, anio, mes]
  );
  if (rows[0]?.estado === "cerrado") {
    throw new ContabilidadError(`El período ${String(mes).padStart(2, "0")}/${anio} está cerrado; no se puede contabilizar.`, 409);
  }
}

/**
 * Genera un asiento balanceado DENTRO de la transacción del documento.
 * Valida líneas (Debe XOR Haber, ≥0, ≥2 líneas, Σdebe=Σhaber, cuentas activas+asentables),
 * verifica período abierto e idempotencia por (empresa, origen_tipo, origen_id, evento_origen).
 */
export async function generarAsientoEnTx(client: Client, schemaRaw: string, empresaId: string, input: GenerarAsientoInput): Promise<AsientoRef> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const lineas = input.lineas;
  if (lineas.length < 2) throw new ContabilidadError("El asiento debe tener al menos dos líneas.");

  let totalDebe = 0, totalHaber = 0;
  for (const l of lineas) {
    const debe = Number(l.debe) || 0, haber = Number(l.haber) || 0;
    if (debe < 0 || haber < 0) throw new ContabilidadError("Los importes del asiento no pueden ser negativos.");
    if (debe > 0 && haber > 0) throw new ContabilidadError("Una línea no puede tener Debe y Haber a la vez.");
    if (debe === 0 && haber === 0) throw new ContabilidadError("Una línea no puede tener ambos importes en cero.");
    if (!l.cuenta_contable_id) throw new ContabilidadError("Cada línea del asiento requiere una cuenta contable.");
    totalDebe += debe; totalHaber += haber;
  }
  if (Math.round(totalDebe) !== Math.round(totalHaber)) {
    throw new ContabilidadError(`Asiento descuadrado: Debe ${Math.round(totalDebe)} ≠ Haber ${Math.round(totalHaber)}.`);
  }

  // Cuentas activas + asentables.
  const ids = Array.from(new Set(lineas.map((l) => l.cuenta_contable_id)));
  const tPC = quoteSchemaTable(schema, "plan_cuentas");
  const { rows: ok } = await client.query<{ id: string }>(
    `SELECT id FROM ${tPC} WHERE empresa_id = $1::uuid AND activo = true AND asentable = true AND id = ANY($2::uuid[])`,
    [empresaId, ids]
  );
  if (ok.length !== ids.length) {
    throw new ContabilidadError("El asiento usa cuentas que no son válidas (deben estar activas y ser asentables).");
  }

  await assertPeriodoAbierto(client, schema, empresaId, input.fecha_contable);

  const tA = quoteSchemaTable(schema, "asientos_contables");
  const { rows: ex } = await client.query<{ id: string; numero_asiento: string }>(
    `SELECT id, numero_asiento FROM ${tA}
      WHERE empresa_id = $1::uuid AND origen_tipo = $2 AND origen_id = $3::uuid AND evento_origen = $4 LIMIT 1`,
    [empresaId, input.origen_tipo, input.origen_id, input.evento_origen]
  );
  if (ex[0]) return { id: ex[0].id, numero: ex[0].numero_asiento };

  const { rows: num } = await client.query<{ numero: string }>(
    `SELECT neura.next_numero_asiento_empresa($1::uuid) AS numero`, [empresaId]
  );
  const numero = num[0].numero;

  const { rows: cab } = await client.query<{ id: string }>(
    `INSERT INTO ${tA} (empresa_id, numero_asiento, fecha_contable, glosa, estado, origen_tipo, origen_id, evento_origen, moneda, tipo_cambio, asiento_original_id, created_by)
     VALUES ($1::uuid, $2, $3::date, $4, 'contabilizado', $5, $6::uuid, $7, $8, $9::numeric, $10::uuid, $11::uuid)
     RETURNING id`,
    [empresaId, numero, input.fecha_contable, input.glosa, input.origen_tipo, input.origen_id, input.evento_origen,
     input.moneda ?? "PYG", input.tipo_cambio ?? 1, input.asiento_original_id ?? null, input.createdBy]
  );
  const asientoId = cab[0].id;

  const tD = quoteSchemaTable(schema, "asientos_contables_detalles");
  for (const l of lineas) {
    await client.query(
      `INSERT INTO ${tD} (empresa_id, asiento_id, cuenta_contable_id, proveedor_id, descripcion, debe, haber, documento_tipo, documento_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::numeric, $7::numeric, $8, $9::uuid)`,
      [empresaId, asientoId, l.cuenta_contable_id, l.proveedor_id ?? null, l.descripcion ?? null,
       Number(l.debe) || 0, Number(l.haber) || 0, l.documento_tipo ?? null, l.documento_id ?? null]
    );
  }
  return { id: asientoId, numero };
}

// ── Constructores de líneas (puros) ──────────────────────────────────────────

export interface LineaFiscal { cuenta_contable_id: string; descripcion: string; subtotal: number; iva_tipo: "exenta" | "5" | "10"; monto_iva: number }

/**
 * Líneas del asiento para un Gasto/Servicio o Compra (base gravada + IVA al Debe;
 * contrapartida al Haber). `contrapartidaId` = cuenta de pago (contado) o proveedores (crédito).
 */
export function construirLineasDocumento(opts: {
  config: ConfigContable | null;
  lineasFiscales: LineaFiscal[];
  total: number;
  esContado: boolean;
  contrapartidaContado: string | null;
  proveedorId: string | null;
  documento_tipo: string;
  documento_id: string;
}): AsientoLineaInput[] {
  const { config, lineasFiscales, total, esContado, contrapartidaContado, proveedorId, documento_tipo, documento_id } = opts;
  const lineas: AsientoLineaInput[] = [];
  for (const lf of lineasFiscales) {
    if (Number(lf.subtotal) > 0) {
      lineas.push({ cuenta_contable_id: lf.cuenta_contable_id, descripcion: lf.descripcion, debe: lf.subtotal, haber: 0, documento_tipo, documento_id });
    }
  }
  const iva5 = lineasFiscales.filter((l) => l.iva_tipo === "5").reduce((s, l) => s + (Number(l.monto_iva) || 0), 0);
  const iva10 = lineasFiscales.filter((l) => l.iva_tipo === "10").reduce((s, l) => s + (Number(l.monto_iva) || 0), 0);
  if (iva5 > 0) {
    if (!config?.cuenta_iva_credito_5_id) throw new ContabilidadError("Configurá la cuenta de IVA Crédito 5% en Configuración Contable.");
    lineas.push({ cuenta_contable_id: config.cuenta_iva_credito_5_id, descripcion: "IVA Crédito 5%", debe: iva5, haber: 0, documento_tipo, documento_id });
  }
  if (iva10 > 0) {
    if (!config?.cuenta_iva_credito_10_id) throw new ContabilidadError("Configurá la cuenta de IVA Crédito 10% en Configuración Contable.");
    lineas.push({ cuenta_contable_id: config.cuenta_iva_credito_10_id, descripcion: "IVA Crédito 10%", debe: iva10, haber: 0, documento_tipo, documento_id });
  }
  if (esContado) {
    if (!contrapartidaContado) throw new ContabilidadError("Falta la cuenta de pago (contrapartida) para la operación al contado.");
    lineas.push({ cuenta_contable_id: contrapartidaContado, descripcion: "Pago", debe: 0, haber: total, documento_tipo, documento_id });
  } else {
    if (!config?.cuenta_proveedores_id) throw new ContabilidadError("Configurá la cuenta general de Proveedores en Configuración Contable.");
    lineas.push({ cuenta_contable_id: config.cuenta_proveedores_id, proveedor_id: proveedorId, descripcion: "Proveedores", debe: 0, haber: total, documento_tipo, documento_id });
  }
  return lineas;
}

/** Carga cabecera + detalles de un asiento (para construir su reversión). */
export async function getAsientoConDetalles(client: Client, schema: string, empresaId: string, asientoId: string): Promise<{
  cabecera: { id: string; fecha_contable: string; glosa: string | null; moneda: string; tipo_cambio: number };
  detalles: AsientoLineaInput[];
} | null> {
  const tA = quoteSchemaTable(schema, "asientos_contables");
  const tD = quoteSchemaTable(schema, "asientos_contables_detalles");
  const { rows: cab } = await client.query<{ id: string; fecha_contable: string; glosa: string | null; moneda: string; tipo_cambio: number }>(
    `SELECT id, fecha_contable, glosa, moneda, tipo_cambio FROM ${tA} WHERE id = $1::uuid AND empresa_id = $2::uuid`,
    [asientoId, empresaId]
  );
  if (!cab[0]) return null;
  const { rows: det } = await client.query<AsientoLineaInput>(
    `SELECT cuenta_contable_id, proveedor_id, descripcion, debe, haber, documento_tipo, documento_id
       FROM ${tD} WHERE asiento_id = $1::uuid AND empresa_id = $2::uuid`,
    [asientoId, empresaId]
  );
  return { cabecera: cab[0], detalles: det };
}
