import { NextRequest, NextResponse } from "next/server";
import { getFacturasSupabaseFromAuth } from "@/lib/facturacion/facturas-service-client";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

export const runtime = "nodejs";

/**
 * GET /api/facturas/[id]/pagos
 * Lista los pagos CONFIRMADOS de una factura (para generar sus recibos).
 * Excluye pagos revertidos (transferencia anulada = no es dinero cobrado).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getFacturasSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { auth, supabase } = ctx;

    const { id } = await params;
    const facturaId = (id ?? "").trim();
    if (!facturaId) return NextResponse.json(errorResponse("id de factura es obligatorio"), { status: 400 });

    const { data, error } = await supabase
      .from("pagos")
      .select("id, monto, fecha_pago, metodo_pago, referencia, recibo_nro, estado_contable")
      .eq("factura_id", facturaId)
      .eq("empresa_id", auth.empresa_id)
      .neq("estado_contable", "revertido")
      .order("fecha_pago", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    const pagos = (data ?? []).map((p) => ({
      id: String(p.id),
      monto: Number(p.monto),
      fecha_pago: p.fecha_pago == null ? null : String(p.fecha_pago),
      metodo_pago: String(p.metodo_pago ?? "efectivo"),
      referencia: p.referencia == null ? null : String(p.referencia),
      recibo_nro: p.recibo_nro == null ? null : Number(p.recibo_nro),
    }));

    return NextResponse.json(successResponse(pagos));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
