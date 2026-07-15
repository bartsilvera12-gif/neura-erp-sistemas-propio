import { NextRequest } from "next/server";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { requireContabilidadApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { buildXlsxBuffer, xlsxResponseHeaders, nowStamp } from "@/lib/excel/export";
import { listLibroMayor } from "@/lib/contabilidad/libros-pg";
import { mayorFiltersFromUrl } from "../route";

export const runtime = "nodejs";

interface FlatRow {
  cuenta: string; denominacion: string; naturaleza: string; tipo: string;
  fecha: string; numero_asiento: string; documento: string; descripcion: string;
  proveedor: string; debe: number; haber: number; saldo: number;
}

export async function GET(request: NextRequest) {
  const auth = await requireContabilidadApiAccess(request);
  if (!auth.ok) return new Response(auth.message, { status: auth.status });
  try {
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    const { cuentas } = await listLibroMayor(schema, auth.empresaId, mayorFiltersFromUrl(new URL(request.url)));
    const flat: FlatRow[] = [];
    const docLabel = (o: string) => (o === "compra" ? "Compra" : o === "gasto_servicio" ? "Gasto y Servicio" : o === "reversion" ? "Reversión" : o);
    for (const c of cuentas) {
      flat.push({ cuenta: c.cuenta_codigo, denominacion: c.denominacion, naturaleza: c.naturaleza, tipo: "SALDO INICIAL", fecha: "", numero_asiento: "", documento: "", descripcion: "", proveedor: "", debe: 0, haber: 0, saldo: c.saldo_inicial });
      for (const m of c.movimientos) {
        flat.push({ cuenta: c.cuenta_codigo, denominacion: c.denominacion, naturaleza: c.naturaleza, tipo: "MOV", fecha: m.fecha_contable, numero_asiento: m.numero_asiento, documento: docLabel(m.origen_tipo), descripcion: m.descripcion ?? "", proveedor: m.proveedor_nombre ?? "", debe: m.debe, haber: m.haber, saldo: m.saldo_acumulado });
      }
      flat.push({ cuenta: c.cuenta_codigo, denominacion: c.denominacion, naturaleza: c.naturaleza, tipo: "SALDO FINAL", fecha: "", numero_asiento: "", documento: "", descripcion: "", proveedor: "", debe: c.total_debe, haber: c.total_haber, saldo: c.saldo_final });
    }
    const buf = buildXlsxBuffer(flat, [
      { header: "CUENTA", value: (r) => r.cuenta, width: 12 },
      { header: "DENOMINACION", value: (r) => r.denominacion, width: 28 },
      { header: "NAT", value: (r) => r.naturaleza, width: 6 },
      { header: "TIPO", value: (r) => r.tipo, width: 14 },
      { header: "FECHA", value: (r) => (r.fecha ? new Date(r.fecha) : ""), width: 12 },
      { header: "N_ASIENTO", value: (r) => r.numero_asiento, width: 14 },
      { header: "DOCUMENTO", value: (r) => r.documento, width: 16 },
      { header: "DESCRIPCION", value: (r) => r.descripcion, width: 28 },
      { header: "PROVEEDOR", value: (r) => r.proveedor, width: 22 },
      { header: "DEBE", value: (r) => r.debe, width: 14 },
      { header: "HABER", value: (r) => r.haber, width: 14 },
      { header: "SALDO", value: (r) => r.saldo, width: 14 },
    ], { sheetName: "Libro Mayor" });
    return new Response(new Uint8Array(buf), { status: 200, headers: xlsxResponseHeaders(`libro-mayor-${nowStamp()}`) });
  } catch (e) {
    console.error("[/api/reportes/libro-mayor/export]", e instanceof Error ? e.message : e);
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
}
