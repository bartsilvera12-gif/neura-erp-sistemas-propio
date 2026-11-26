import * as XLSX from "xlsx";
import { ctxV2, fallo } from "@/lib/erp2/server";
import { listarMovimientos } from "@/lib/erp2/inventario-docs";

export const runtime = "nodejs";

/** Excel de los movimientos con los mismos filtros de la pantalla (hasta 5.000). */
export async function GET(request: Request) {
  try {
    const c = await ctxV2(request, "inventario");
    const sp = new URL(request.url).searchParams;
    sp.set("pagina", "1");
    sp.set("por_pagina", "200");
    const filas: Record<string, unknown>[] = [];
    for (let p = 1; p <= 25; p++) {
      sp.set("pagina", String(p));
      const { rows } = await listarMovimientos(c.pool, c.empresaId, sp);
      filas.push(...rows);
      if (rows.length < 200) break;
    }
    const hoja = XLSX.utils.json_to_sheet(
      filas.map((m) => ({
        Fecha: new Date(String(m.fecha)).toLocaleString("es-PY", { timeZone: "America/Asuncion" }),
        Producto: m.producto_nombre,
        SKU: m.producto_sku,
        Tipo: m.tipo,
        Cantidad: m.cantidad,
        "Costo unit.": m.costo_unitario,
        Origen: m.origen,
        Depósito: m.deposito_nombre ?? "",
        Documento: m.documento_numero ?? "",
        Usuario: m.usuario_nombre ?? "",
      }))
    );
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Movimientos");
    const buf = XLSX.write(libro, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="movimientos.xlsx"`,
      },
    });
  } catch (err) {
    return fallo(err, "GET /inventario/movimientos/export");
  }
}
