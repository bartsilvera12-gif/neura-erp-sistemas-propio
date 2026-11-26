import * as XLSX from "xlsx";
import { ctxV2, fallo } from "@/lib/erp2/server";
import { listarCuentasPagar } from "@/lib/erp2/pagos";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const c = await ctxV2(request, "compras");
    const sp = new URL(request.url).searchParams;
    sp.set("pagina", "1");
    sp.set("por_pagina", "200");
    const { rows } = await listarCuentasPagar(c.pool, c.empresaId, sp);
    const hoja = XLSX.utils.json_to_sheet(
      rows.map((r) => ({
        Proveedor: r.proveedor_nombre, RUC: r.proveedor_ruc ?? "", Factura: r.numero, Compra: r.compra_numero,
        Emisión: r.fecha_emision, Vence: r.vencimiento, Monto: r.monto, Pagado: r.pagado, Saldo: r.saldo, Estado: r.estado,
        "Días de atraso": r.dias_atraso,
      }))
    );
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Cuentas a pagar");
    const buf = XLSX.write(libro, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="cuentas-a-pagar.xlsx"`,
      },
    });
  } catch (err) {
    return fallo(err, "GET /cuentas-pagar/export");
  }
}
