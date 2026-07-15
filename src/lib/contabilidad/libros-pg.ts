import "server-only";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}
function n(v: unknown): number { const x = Number(v); return Number.isFinite(x) ? x : 0; }

// ── Libro Diario ─────────────────────────────────────────────────────────────
export interface DiarioRow {
  numero_asiento: string;
  fecha_contable: string;
  glosa: string | null;
  origen_tipo: string;
  documento: string | null;
  cuenta_codigo: string;
  cuenta_denominacion: string;
  proveedor_nombre: string | null;
  debe: number;
  haber: number;
  estado: string;
}
export interface DiarioFilters {
  desde?: string | null; hasta?: string | null; cuenta_id?: string | null;
  origen?: string | null; estado?: string | null; numero_asiento?: string | null; proveedor_id?: string | null;
}

export async function listLibroDiario(schemaRaw: string, empresaId: string, f: DiarioFilters = {}) {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tA = quoteSchemaTable(schema, "asientos_contables");
  const tD = quoteSchemaTable(schema, "asientos_contables_detalles");
  const tPC = quoteSchemaTable(schema, "plan_cuentas");
  const tPr = quoteSchemaTable(schema, "proveedores");
  const params: unknown[] = [empresaId];
  const where: string[] = ["a.empresa_id = $1::uuid"];
  const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
  if (f.desde) where.push(`a.fecha_contable >= ${add(f.desde)}::date`);
  if (f.hasta) where.push(`a.fecha_contable <= ${add(f.hasta)}::date`);
  if (f.cuenta_id) where.push(`d.cuenta_contable_id = ${add(f.cuenta_id)}::uuid`);
  if (f.origen) where.push(`a.origen_tipo = ${add(f.origen)}`);
  if (f.estado) where.push(`a.estado = ${add(f.estado)}`);
  if (f.numero_asiento) where.push(`a.numero_asiento ILIKE ${add("%" + f.numero_asiento + "%")}`);
  if (f.proveedor_id) where.push(`d.proveedor_id = ${add(f.proveedor_id)}::uuid`);

  const { rows } = await pool().query<DiarioRow>(
    `SELECT a.numero_asiento, a.fecha_contable, a.glosa, a.origen_tipo, a.estado,
            d.debe, d.haber, pc.cuenta AS cuenta_codigo, pc.denominacion AS cuenta_denominacion,
            pr.nombre AS proveedor_nombre,
            COALESCE(d.documento_tipo,'') || CASE WHEN d.documento_id IS NOT NULL THEN '' ELSE '' END AS documento
       FROM ${tA} a
       JOIN ${tD} d ON d.asiento_id = a.id
       JOIN ${tPC} pc ON pc.id = d.cuenta_contable_id
       LEFT JOIN ${tPr} pr ON pr.id = d.proveedor_id
      WHERE ${where.join(" AND ")}
      ORDER BY a.fecha_contable ASC, a.numero_asiento ASC, d.created_at ASC`,
    params
  );
  const rowsOut: DiarioRow[] = rows.map((r) => ({
    ...r, debe: n(r.debe), haber: n(r.haber),
    documento: r.origen_tipo === "compra" ? "Compra" : r.origen_tipo === "gasto_servicio" ? "Gasto y Servicio" : r.origen_tipo === "reversion" ? "Reversión" : r.origen_tipo,
  }));
  const totalDebe = rowsOut.reduce((s, r) => s + r.debe, 0);
  const totalHaber = rowsOut.reduce((s, r) => s + r.haber, 0);
  return { rows: rowsOut, totales: { totalDebe, totalHaber, diferencia: Math.round(totalDebe - totalHaber) } };
}

// ── Libro Mayor ──────────────────────────────────────────────────────────────
export interface MayorMovimiento {
  fecha_contable: string; numero_asiento: string; origen_tipo: string; descripcion: string | null;
  proveedor_nombre: string | null; debe: number; haber: number; saldo_acumulado: number;
}
export interface MayorCuenta {
  cuenta_codigo: string; denominacion: string; naturaleza: string;
  saldo_inicial: number; movimientos: MayorMovimiento[]; total_debe: number; total_haber: number; saldo_final: number;
}
export interface MayorFilters {
  desde?: string | null; hasta?: string | null; cuenta_id?: string | null;
  nivel?: string | null; naturaleza?: string | null; origen?: string | null; proveedor_id?: string | null;
}

export async function listLibroMayor(schemaRaw: string, empresaId: string, f: MayorFilters = {}) {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tA = quoteSchemaTable(schema, "asientos_contables");
  const tD = quoteSchemaTable(schema, "asientos_contables_detalles");
  const tPC = quoteSchemaTable(schema, "plan_cuentas");
  const tPr = quoteSchemaTable(schema, "proveedores");
  const params: unknown[] = [empresaId];
  const where: string[] = ["a.empresa_id = $1::uuid"];
  const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
  if (f.hasta) where.push(`a.fecha_contable <= ${add(f.hasta)}::date`);
  if (f.cuenta_id) where.push(`d.cuenta_contable_id = ${add(f.cuenta_id)}::uuid`);
  if (f.nivel) where.push(`pc.nivel = ${add(Number(f.nivel))}`);
  if (f.naturaleza) where.push(`pc.naturaleza = ${add(f.naturaleza)}`);
  if (f.origen) where.push(`a.origen_tipo = ${add(f.origen)}`);
  if (f.proveedor_id) where.push(`d.proveedor_id = ${add(f.proveedor_id)}::uuid`);

  const { rows } = await pool().query<{
    cuenta_id: string; cuenta_codigo: string; denominacion: string; naturaleza: string;
    fecha_contable: string; numero_asiento: string; origen_tipo: string; descripcion: string | null;
    proveedor_nombre: string | null; debe: string; haber: string;
  }>(
    `SELECT d.cuenta_contable_id AS cuenta_id, pc.cuenta AS cuenta_codigo, pc.denominacion, pc.naturaleza,
            a.fecha_contable, a.numero_asiento, a.origen_tipo, d.descripcion,
            pr.nombre AS proveedor_nombre, d.debe, d.haber
       FROM ${tA} a
       JOIN ${tD} d ON d.asiento_id = a.id
       JOIN ${tPC} pc ON pc.id = d.cuenta_contable_id
       LEFT JOIN ${tPr} pr ON pr.id = d.proveedor_id
      WHERE ${where.join(" AND ")}
      ORDER BY pc.cuenta ASC, a.fecha_contable ASC, a.numero_asiento ASC, d.created_at ASC`,
    params
  );

  const desde = f.desde || null;
  const byCuenta = new Map<string, MayorCuenta>();
  for (const r of rows) {
    let c = byCuenta.get(r.cuenta_id);
    if (!c) {
      c = { cuenta_codigo: r.cuenta_codigo, denominacion: r.denominacion, naturaleza: r.naturaleza, saldo_inicial: 0, movimientos: [], total_debe: 0, total_haber: 0, saldo_final: 0 };
      byCuenta.set(r.cuenta_id, c);
    }
    const debe = n(r.debe), haber = n(r.haber);
    const delta = r.naturaleza === "A" ? haber - debe : debe - haber; // según naturaleza
    if (desde && r.fecha_contable < desde) {
      c.saldo_inicial += delta; // movimientos anteriores → saldo inicial
    } else {
      c.movimientos.push({
        fecha_contable: r.fecha_contable, numero_asiento: r.numero_asiento, origen_tipo: r.origen_tipo,
        descripcion: r.descripcion, proveedor_nombre: r.proveedor_nombre, debe, haber, saldo_acumulado: 0,
      });
      c.total_debe += debe; c.total_haber += haber;
    }
  }
  const cuentas: MayorCuenta[] = [];
  for (const c of byCuenta.values()) {
    let saldo = c.saldo_inicial;
    for (const m of c.movimientos) {
      saldo += c.naturaleza === "A" ? m.haber - m.debe : m.debe - m.haber;
      m.saldo_acumulado = saldo;
    }
    c.saldo_final = saldo;
    // Si hay filtro `desde` y la cuenta no tiene movimientos en la ventana pero sí saldo inicial, igual se muestra.
    cuentas.push(c);
  }
  cuentas.sort((a, b) => a.cuenta_codigo.localeCompare(b.cuenta_codigo, "es"));
  const totalDebe = cuentas.reduce((s, c) => s + c.total_debe, 0);
  const totalHaber = cuentas.reduce((s, c) => s + c.total_haber, 0);
  return { cuentas, totales: { totalDebe, totalHaber, diferencia: Math.round(totalDebe - totalHaber) } };
}
