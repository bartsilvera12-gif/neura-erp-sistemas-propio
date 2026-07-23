import { NextRequest } from "next/server";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { requireContabilidadApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { buildXlsxBuffer, xlsxResponseHeaders, nowStamp } from "@/lib/excel/export";
import { listLibroVentas, computeTotals, type LibroVentaFilters, type LibroVentaRow } from "@/lib/libro-ventas/libro-ventas-pg";

export const runtime = "nodejs";

const num = (v: string | number) => Number(v) || 0;

/** GET /api/reportes/libro-ventas/export — Excel del Libro de Ventas (respeta filtros y totales). */
export async function GET(request: NextRequest) {
  const auth = await requireContabilidadApiAccess(request);
  if (!auth.ok) return new Response(auth.message, { status: auth.status });
  try {
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    const url = new URL(request.url);
    const g = (k: string) => url.searchParams.get(k) || undefined;
    const cond = g("condicion"); const origen = g("origen"); const tipo = g("tipo");
    const filters: LibroVentaFilters = {
      desde: g("desde"), hasta: g("hasta"), cliente_id: g("cliente_id"),
      condicion: cond === "contado" || cond === "credito" ? cond : undefined,
      origen: origen === "manual" || origen === "suscripcion" ? origen : undefined,
      tipo: tipo === "factura" || tipo === "nota_credito" ? tipo : undefined,
    };
    const rows = await listLibroVentas(schema, auth.empresaId, filters);
    const totals = computeTotals(rows);

    const totalsRow: LibroVentaRow = {
      origen_tipo: "factura", origen: "manual", fecha: null, cliente: "TOTALES", ruc: null,
      tipo_comprobante: "", timbrado: null, numero: null, condicion: null,
      exento: totals.exento, gravado5: totals.gravado5, iva5: totals.iva5,
      gravado10: totals.gravado10, iva10: totals.iva10, total: totals.total, estado: "", cliente_id: null,
    };

    const buf = buildXlsxBuffer(
      [...rows, totalsRow],
      [
        { header: "FECHA", value: (r) => (r.fecha ? new Date(r.fecha) : ""), width: 12 },
        { header: "COMPROBANTE", value: (r) => r.tipo_comprobante, width: 16 },
        { header: "ORIGEN", value: (r) => r.origen, width: 12 },
        { header: "CLIENTE", value: (r) => r.cliente ?? "", width: 30 },
        { header: "RUC", value: (r) => r.ruc ?? "", width: 14 },
        { header: "TIMBRADO", value: (r) => r.timbrado ?? "", width: 14 },
        { header: "NUMERO", value: (r) => r.numero ?? "", width: 16 },
        { header: "CONDICION", value: (r) => r.condicion ?? "", width: 10 },
        { header: "EXENTO", value: (r) => num(r.exento), width: 14 },
        { header: "GRAVADO_5", value: (r) => num(r.gravado5), width: 14 },
        { header: "IVA_5", value: (r) => num(r.iva5), width: 12 },
        { header: "GRAVADO_10", value: (r) => num(r.gravado10), width: 14 },
        { header: "IVA_10", value: (r) => num(r.iva10), width: 12 },
        { header: "TOTAL", value: (r) => num(r.total), width: 14 },
        { header: "ESTADO", value: (r) => r.estado, width: 12 },
      ],
      { sheetName: "Libro de Ventas" }
    );

    return new Response(new Uint8Array(buf), { status: 200, headers: xlsxResponseHeaders(`libro-ventas-${nowStamp()}`) });
  } catch (err) {
    console.error("[/api/reportes/libro-ventas/export]", err instanceof Error ? err.message : err);
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
}
