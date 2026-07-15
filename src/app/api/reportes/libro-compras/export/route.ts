import { NextRequest } from "next/server";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { requireContabilidadApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { buildXlsxBuffer, xlsxResponseHeaders, nowStamp } from "@/lib/excel/export";
import { listLibroCompras, computeTotals, type LibroFilters, type LibroCompraRow } from "@/lib/libro-compras/libro-compras-pg";

export const runtime = "nodejs";

function num(v: string | number): number {
  return Number(v) || 0;
}

/** GET /api/reportes/libro-compras/export — Excel del Libro de Compras (respeta filtros y totales). */
export async function GET(request: NextRequest) {
  const auth = await requireContabilidadApiAccess(request);
  if (!auth.ok) return new Response(auth.message, { status: auth.status });
  try {
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    const url = new URL(request.url);
    const g = (k: string) => url.searchParams.get(k) || undefined;
    const origen = g("origen");
    const filters: LibroFilters = {
      desde: g("desde"), hasta: g("hasta"), proveedor_id: g("proveedor_id"),
      origen: origen === "compra" || origen === "gasto" ? origen : undefined,
      tipo_comprobante: g("tipo_comprobante"), condicion: g("condicion"),
    };
    const rows = await listLibroCompras(schema, auth.empresaId, filters);
    const totals = computeTotals(rows);

    // Fila de totales al final.
    const totalsRow: LibroCompraRow = {
      origen_tipo: "compra", origen: "TOTALES", fecha: null, proveedor: null, ruc: null,
      tipo_comprobante: null, timbrado: null, numero: null, condicion: null,
      exento: totals.exento, gravado5: totals.gravado5, iva5: totals.iva5,
      gravado10: totals.gravado10, iva10: totals.iva10, total: totals.total, estado: "", proveedor_id: null,
    };
    const data = [...rows, totalsRow];

    const buf = buildXlsxBuffer(
      data,
      [
        { header: "FECHA", value: (r) => (r.fecha ? new Date(r.fecha) : ""), width: 12 },
        { header: "ORIGEN", value: (r) => r.origen, width: 16 },
        { header: "PROVEEDOR", value: (r) => r.proveedor ?? "", width: 30 },
        { header: "RUC", value: (r) => r.ruc ?? "", width: 14 },
        { header: "TIPO_COMPROBANTE", value: (r) => r.tipo_comprobante ?? "", width: 16 },
        { header: "TIMBRADO", value: (r) => r.timbrado ?? "", width: 14 },
        { header: "NUMERO", value: (r) => r.numero ?? "", width: 14 },
        { header: "CONDICION", value: (r) => r.condicion ?? "", width: 10 },
        { header: "EXENTO", value: (r) => num(r.exento), width: 14 },
        { header: "GRAVADO_5", value: (r) => num(r.gravado5), width: 14 },
        { header: "IVA_5", value: (r) => num(r.iva5), width: 12 },
        { header: "GRAVADO_10", value: (r) => num(r.gravado10), width: 14 },
        { header: "IVA_10", value: (r) => num(r.iva10), width: 12 },
        { header: "TOTAL", value: (r) => num(r.total), width: 14 },
        { header: "ESTADO", value: (r) => r.estado, width: 12 },
      ],
      { sheetName: "Libro de Compras" }
    );

    return new Response(new Uint8Array(buf), { status: 200, headers: xlsxResponseHeaders(`libro-compras-${nowStamp()}`) });
  } catch (err) {
    console.error("[/api/reportes/libro-compras/export]", err instanceof Error ? err.message : err);
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
}
