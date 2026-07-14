import { buildXlsxBuffer, xlsxResponseHeaders } from "@/lib/excel/export";

/** Fila de ejemplo con los encabezados admitidos exactos. */
const TEMPLATE_ROW = {
  Cuenta: "11115",
  "Denominación": "Caja Secundaria",
  Nivel: 5,
  Naturaleza: "D",
  Asentable: "S",
  "Centro Costo": "NO",
  Moneda: "Local",
  "Tipo cambio": "Comprador",
  "Cuenta SSET": "1 01 01 01",
} as const;

export const runtime = "nodejs";

export async function GET() {
  const cols = Object.keys(TEMPLATE_ROW).map((k) => ({
    header: k,
    value: (r: typeof TEMPLATE_ROW) => r[k as keyof typeof TEMPLATE_ROW],
    width: 20,
  }));
  const buf = buildXlsxBuffer([TEMPLATE_ROW], cols, { sheetName: "Plan de Cuentas" });
  return new Response(new Uint8Array(buf), { status: 200, headers: xlsxResponseHeaders("plantilla-plan-de-cuentas") });
}
