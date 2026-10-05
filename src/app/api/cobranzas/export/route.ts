import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { requireCobranzasModuleAccess } from "@/lib/cobranzas/cobranzas-auth";
import { cargarCobranzas, hoyAsuncionYmd, type TramoKey } from "@/lib/cobranzas/cobranzas-data";
import { buildXlsxBuffer, xlsxResponseHeaders, nowStamp, type ExportColumn } from "@/lib/excel/export";
import { errorResponse } from "@/lib/api/response";

/** Fila plana de la exportación: un servicio (suscripción) de un cliente con deuda. */
type FilaExport = {
  cliente: string;
  tipo: string;
  plan: string | null;
  monto_mensual: number | null;
  total_adeudado: number;
  cuotas_vencidas: number;
  tramo: string;
  meses_adeudados: string;
  proximo_vencimiento: string | null;
  mensaje_mes: string;
  mensaje_mes_fecha: string | null;
  ultimo_pago: string | null;
  promesa_pago: string | null;
};

const TRAMO_LABEL: Record<TramoKey, string> = {
  por_vencer: "Por vencer",
  tramo_1: "Tramo 1",
  tramo_2: "Tramo 2",
  tramo_3: "Tramo 3",
};

/** GET — exporta la base de Seguimiento Cobranzas (clientes con deuda) a .xlsx. */
export async function GET(request: Request) {
  const auth = await requireCobranzasModuleAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const hoy = hoyAsuncionYmd(new Date());
    const { clientes } = await cargarCobranzas(sb, auth.empresaId, hoy);

    // Una fila por servicio/suscripción (igual que la tabla).
    const filas: FilaExport[] = [];
    for (const c of clientes) {
      for (const s of c.servicios) {
        filas.push({
          cliente: c.cliente_label,
          tipo: s.tipo,
          plan: s.plan,
          monto_mensual: s.monto_mensual,
          total_adeudado: s.total_adeudado,
          cuotas_vencidas: s.cuotas_vencidas,
          tramo: TRAMO_LABEL[s.tramo],
          meses_adeudados: s.meses_adeudados.join(", "),
          proximo_vencimiento: s.proximo_vencimiento,
          mensaje_mes: c.mensaje_mes_enviado ? "Sí" : "No",
          mensaje_mes_fecha: c.mensaje_mes_fecha,
          ultimo_pago: c.ultimo_pago,
          promesa_pago: c.promesa_fecha,
        });
      }
    }

    const columns: ExportColumn<FilaExport>[] = [
      { header: "Cliente", value: (r) => r.cliente, width: 34 },
      { header: "Tipo", value: (r) => r.tipo, width: 14 },
      { header: "Plan", value: (r) => r.plan ?? "", width: 24 },
      { header: "Monto mensual", value: (r) => r.monto_mensual ?? "", width: 15 },
      { header: "Total adeudado", value: (r) => r.total_adeudado, width: 15 },
      { header: "Cuotas vencidas", value: (r) => r.cuotas_vencidas, width: 15 },
      { header: "Tramo", value: (r) => r.tramo, width: 12 },
      { header: "Meses adeudados", value: (r) => r.meses_adeudados, width: 22 },
      { header: "Próximo vencimiento", value: (r) => r.proximo_vencimiento ?? "", width: 18 },
      { header: "Mensaje del mes", value: (r) => r.mensaje_mes, width: 14 },
      { header: "Fecha mensaje", value: (r) => r.mensaje_mes_fecha ?? "", width: 14 },
      { header: "Último pago", value: (r) => r.ultimo_pago ?? "", width: 14 },
      { header: "Promesa de pago", value: (r) => r.promesa_pago ?? "", width: 14 },
    ];

    const buf = buildXlsxBuffer(filas, columns, { sheetName: "Cobranzas" });
    const filename = `cobranzas-${hoy}-${nowStamp()}`;
    return new NextResponse(new Uint8Array(buf), { headers: xlsxResponseHeaders(filename) });
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error"), { status: 500 });
  }
}
