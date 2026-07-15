import { NextRequest } from "next/server";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { requireContabilidadApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { buildXlsxBuffer, xlsxResponseHeaders, nowStamp } from "@/lib/excel/export";
import { listLibroDiario, type DiarioRow } from "@/lib/contabilidad/libros-pg";
import { diarioFiltersFromUrl } from "../route";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireContabilidadApiAccess(request);
  if (!auth.ok) return new Response(auth.message, { status: auth.status });
  try {
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    const { rows, totales } = await listLibroDiario(schema, auth.empresaId, diarioFiltersFromUrl(new URL(request.url)));
    const totalRow: DiarioRow = {
      numero_asiento: "TOTALES", fecha_contable: "", glosa: null, origen_tipo: "", documento: null,
      cuenta_codigo: "", cuenta_denominacion: "", proveedor_nombre: null,
      debe: totales.totalDebe, haber: totales.totalHaber, estado: "",
    };
    const data = [...rows, totalRow];
    const buf = buildXlsxBuffer(data, [
      { header: "N_ASIENTO", value: (r) => r.numero_asiento, width: 14 },
      { header: "FECHA", value: (r) => (r.fecha_contable ? new Date(r.fecha_contable) : ""), width: 12 },
      { header: "GLOSA", value: (r) => r.glosa ?? "", width: 30 },
      { header: "ORIGEN", value: (r) => r.documento ?? "", width: 16 },
      { header: "CUENTA", value: (r) => r.cuenta_codigo, width: 12 },
      { header: "DENOMINACION", value: (r) => r.cuenta_denominacion, width: 28 },
      { header: "PROVEEDOR", value: (r) => r.proveedor_nombre ?? "", width: 24 },
      { header: "DEBE", value: (r) => r.debe, width: 14 },
      { header: "HABER", value: (r) => r.haber, width: 14 },
      { header: "ESTADO", value: (r) => r.estado, width: 12 },
    ], { sheetName: "Libro Diario" });
    return new Response(new Uint8Array(buf), { status: 200, headers: xlsxResponseHeaders(`libro-diario-${nowStamp()}`) });
  } catch (e) {
    console.error("[/api/reportes/libro-diario/export]", e instanceof Error ? e.message : e);
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
}
