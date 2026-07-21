import { NextRequest } from "next/server";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { requireContabilidadApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { buildXlsxBuffer, xlsxResponseHeaders, nowStamp } from "@/lib/excel/export";
import { listCuentasPorPagar, computeTotals, type CuentasPagarFilters, type CuentaPagarRow } from "@/lib/reportes/cuentas-pagar-pg";

export const runtime = "nodejs";

const num = (v: string | number) => Number(v) || 0;

/** GET /api/reportes/cuentas-por-pagar/export — Excel de Cuentas por Pagar. */
export async function GET(request: NextRequest) {
  const auth = await requireContabilidadApiAccess(request);
  if (!auth.ok) return new Response(auth.message, { status: auth.status });
  try {
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    const url = new URL(request.url);
    const g = (k: string) => url.searchParams.get(k) || undefined;
    const filters: CuentasPagarFilters = { desde: g("desde"), hasta: g("hasta"), proveedor_id: g("proveedor_id"), estado: g("estado") };
    const rows = await listCuentasPorPagar(schema, auth.empresaId, filters);
    const totals = computeTotals(rows);

    const totalsRow: CuentaPagarRow = {
      compra_id: "", numero_control: "TOTALES", fecha: null, fecha_vencimiento: null,
      proveedor_id: null, proveedor: null, ruc: null, tipo_comprobante: null, numero_comprobante: null,
      timbrado: null, plazo_dias: null, cuotas: 0, total: totals.total, monto_cuota: 0,
      vencida: false, dias_para_vencer: null,
    };

    const buf = buildXlsxBuffer(
      [...rows, totalsRow],
      [
        { header: "N_CONTROL", value: (r) => r.numero_control, width: 14 },
        { header: "FECHA", value: (r) => (r.fecha ? new Date(r.fecha) : ""), width: 12 },
        { header: "VENCIMIENTO", value: (r) => (r.fecha_vencimiento ? new Date(r.fecha_vencimiento) : ""), width: 12 },
        { header: "PROVEEDOR", value: (r) => r.proveedor ?? "", width: 30 },
        { header: "RUC", value: (r) => r.ruc ?? "", width: 14 },
        { header: "COMPROBANTE", value: (r) => [r.tipo_comprobante, r.numero_comprobante].filter(Boolean).join(" "), width: 22 },
        { header: "TIMBRADO", value: (r) => r.timbrado ?? "", width: 14 },
        { header: "PLAZO_DIAS", value: (r) => (r.plazo_dias == null ? "" : Number(r.plazo_dias)), width: 10 },
        { header: "CUOTAS", value: (r) => (r.cuotas ? Number(r.cuotas) : ""), width: 8 },
        { header: "MONTO_CUOTA", value: (r) => num(r.monto_cuota), width: 14 },
        { header: "TOTAL_ADEUDADO", value: (r) => num(r.total), width: 16 },
        { header: "ESTADO", value: (r) => (r.numero_control === "TOTALES" ? "" : r.vencida ? "VENCIDA" : "POR VENCER"), width: 12 },
      ],
      { sheetName: "Cuentas por Pagar" }
    );

    return new Response(new Uint8Array(buf), { status: 200, headers: xlsxResponseHeaders(`cuentas-por-pagar-${nowStamp()}`) });
  } catch (err) {
    console.error("[/api/reportes/cuentas-por-pagar/export]", err instanceof Error ? err.message : err);
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
}
