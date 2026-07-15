import "server-only";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { ContabilidadError } from "@/lib/contabilidad/asientos-pg";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

const CONFIG_FIELDS = [
  "cuenta_iva_credito_5_id",
  "cuenta_iva_credito_10_id",
  "cuenta_proveedores_id",
  "cuenta_caja_id",
  "cuenta_banco_id",
] as const;
type ConfigField = (typeof CONFIG_FIELDS)[number];

export interface ConfigContableView {
  cuenta_iva_credito_5_id: string | null;
  cuenta_iva_credito_10_id: string | null;
  cuenta_proveedores_id: string | null;
  cuenta_caja_id: string | null;
  cuenta_banco_id: string | null;
}

export async function getConfigView(schemaRaw: string, empresaId: string): Promise<ConfigContableView> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "configuracion_contable");
  const { rows } = await pool().query<ConfigContableView>(
    `SELECT cuenta_iva_credito_5_id, cuenta_iva_credito_10_id, cuenta_proveedores_id, cuenta_caja_id, cuenta_banco_id
       FROM ${t} WHERE empresa_id = $1::uuid`,
    [empresaId]
  );
  return rows[0] ?? {
    cuenta_iva_credito_5_id: null, cuenta_iva_credito_10_id: null, cuenta_proveedores_id: null,
    cuenta_caja_id: null, cuenta_banco_id: null,
  };
}

/** Guarda la configuración; valida que cada cuenta elegida sea activa + asentable. */
export async function saveConfig(schemaRaw: string, empresaId: string, body: Record<string, unknown>, userId: string | null): Promise<ConfigContableView> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "configuracion_contable");
  const tPC = quoteSchemaTable(schema, "plan_cuentas");

  const values: Record<ConfigField, string | null> = {
    cuenta_iva_credito_5_id: null, cuenta_iva_credito_10_id: null, cuenta_proveedores_id: null,
    cuenta_caja_id: null, cuenta_banco_id: null,
  };
  const idsToValidate: string[] = [];
  for (const f of CONFIG_FIELDS) {
    const v = body[f];
    const s = v == null || String(v).trim() === "" ? null : String(v).trim();
    values[f] = s;
    if (s) idsToValidate.push(s);
  }
  if (idsToValidate.length > 0) {
    const uniq = Array.from(new Set(idsToValidate));
    const { rows } = await pool().query<{ id: string }>(
      `SELECT id FROM ${tPC} WHERE empresa_id = $1::uuid AND activo = true AND asentable = true AND id = ANY($2::uuid[])`,
      [empresaId, uniq]
    );
    const ok = new Set(rows.map((r) => r.id));
    if (uniq.some((id) => !ok.has(id))) {
      throw new ContabilidadError("Solo se pueden elegir cuentas activas y asentables (no agrupadoras). Creá una subcuenta asentable en el Plan de Cuentas si hace falta.");
    }
  }

  await pool().query(
    `INSERT INTO ${t} (empresa_id, cuenta_iva_credito_5_id, cuenta_iva_credito_10_id, cuenta_proveedores_id, cuenta_caja_id, cuenta_banco_id, updated_by)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::uuid)
     ON CONFLICT (empresa_id) DO UPDATE SET
       cuenta_iva_credito_5_id = EXCLUDED.cuenta_iva_credito_5_id,
       cuenta_iva_credito_10_id = EXCLUDED.cuenta_iva_credito_10_id,
       cuenta_proveedores_id = EXCLUDED.cuenta_proveedores_id,
       cuenta_caja_id = EXCLUDED.cuenta_caja_id,
       cuenta_banco_id = EXCLUDED.cuenta_banco_id,
       updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [empresaId, values.cuenta_iva_credito_5_id, values.cuenta_iva_credito_10_id, values.cuenta_proveedores_id, values.cuenta_caja_id, values.cuenta_banco_id, userId]
  );
  return getConfigView(schema, empresaId);
}

export interface PeriodoRow {
  id: string; anio: number; mes: number; fecha_desde: string; fecha_hasta: string;
  estado: string; cerrado_at: string | null;
}

export async function listPeriodos(schemaRaw: string, empresaId: string): Promise<PeriodoRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "periodos_contables");
  const { rows } = await pool().query<PeriodoRow>(
    `SELECT id, anio, mes, fecha_desde, fecha_hasta, estado, cerrado_at
       FROM ${t} WHERE empresa_id = $1::uuid ORDER BY anio DESC, mes DESC`,
    [empresaId]
  );
  return rows;
}

/** Crea/actualiza el período (anio, mes) con el estado dado (abierto|cerrado). */
export async function upsertPeriodo(schemaRaw: string, empresaId: string, anio: number, mes: number, estado: "abierto" | "cerrado", userId: string | null): Promise<PeriodoRow> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw new ContabilidadError("Año/mes inválido.");
  }
  if (estado !== "abierto" && estado !== "cerrado") throw new ContabilidadError("Estado de período inválido.");
  const t = quoteSchemaTable(schema, "periodos_contables");
  const desde = `${anio}-${String(mes).padStart(2, "0")}-01`;
  const hastaDay = new Date(anio, mes, 0).getDate();
  const hasta = `${anio}-${String(mes).padStart(2, "0")}-${String(hastaDay).padStart(2, "0")}`;
  const cerrado = estado === "cerrado";
  const { rows } = await pool().query<PeriodoRow>(
    `INSERT INTO ${t} (empresa_id, anio, mes, fecha_desde, fecha_hasta, estado, cerrado_by, cerrado_at)
     VALUES ($1::uuid, $2, $3, $4::date, $5::date, $6, $7::uuid, ${cerrado ? "now()" : "NULL"})
     ON CONFLICT (empresa_id, anio, mes) DO UPDATE SET
       estado = EXCLUDED.estado,
       cerrado_by = CASE WHEN EXCLUDED.estado='cerrado' THEN $7::uuid ELSE NULL END,
       cerrado_at = CASE WHEN EXCLUDED.estado='cerrado' THEN now() ELSE NULL END,
       updated_at = now()
     RETURNING id, anio, mes, fecha_desde, fecha_hasta, estado, cerrado_at`,
    [empresaId, anio, mes, desde, hasta, estado, userId]
  );
  return rows[0];
}
