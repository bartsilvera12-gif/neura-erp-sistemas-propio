import { POST as codigoInterno } from "@/app/api/productos/codigo-interno/route";
import { ctxV2, ErrorV2, fallo, ok } from "@/lib/erp2/server";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

/**
 * Genera un SKU (a partir del nombre, sin repetir) o un código de barras (el interno de Neura,
 * con su secuencia de siempre).
 */
export async function POST(request: Request) {
  try {
    const c = await ctxV2(request, "inventario");
    const b = (await request.clone().json().catch(() => ({}))) as { tipo?: string; nombre?: string };
    if (b.tipo === "sku") {
      const base =
        String(b.nombre ?? "")
          .normalize("NFD")
          .replace(/\p{M}/gu, "")
          .toUpperCase()
          .replace(/[^A-Z0-9 ]/g, " ")
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 3)
          .map((w) => w.slice(0, 4))
          .join("_") || "PROD";
      for (let n = 1; n < 10000; n++) {
        const codigo = `${base}_${String(n).padStart(4, "0")}`;
        const { rowCount } = await c.pool.query(`SELECT 1 FROM neura.productos WHERE empresa_id = $1::uuid AND sku = $2`, [c.empresaId, codigo]);
        if (!rowCount) return ok({ codigo });
      }
      throw new ErrorV2("No se pudo generar el SKU");
    }
    const res = await codigoInterno(request as NextRequest);
    const j = (await res.json().catch(() => null)) as { success?: boolean; data?: { codigo?: string }; error?: string } | null;
    if (!j?.success || !j.data?.codigo) throw new ErrorV2(j?.error ?? "No se pudo generar el código");
    return ok({ codigo: j.data.codigo });
  } catch (err) {
    return fallo(err, "POST /productos/generar-codigo");
  }
}
