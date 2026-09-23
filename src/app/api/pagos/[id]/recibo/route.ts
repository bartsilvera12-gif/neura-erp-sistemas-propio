import { NextRequest, NextResponse } from "next/server";
import { getFacturasSupabaseFromAuth } from "@/lib/facturacion/facturas-service-client";
import { errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { downloadSifenObject } from "@/lib/sifen/sifen-storage";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { asignarReciboNumero, formatReciboNro } from "@/lib/recibos/recibo-numero-pg";
import { buildReciboPdfBuffer, type ReciboBranding } from "@/lib/recibos/recibo-pdf";
import { nombreClienteDisplay } from "@/lib/clientes/display-name";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

export const runtime = "nodejs";

/** Emisor (razón social + RUC) y branding KuDE/PDF desde empresa_sifen_config. */
async function loadEmisorYBranding(
  supabase: AppSupabaseClient,
  empresaId: string
): Promise<{ nombre: string; ruc: string | null; branding: ReciboBranding | null }> {
  const fallback = { nombre: "Neura", ruc: null as string | null, branding: null as ReciboBranding | null };
  const { data, error } = await supabase
    .from("empresa_sifen_config")
    .select("razon_social, ruc, kude_logo_path, kude_color_primario, kude_color_primario_fill")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (error || !data) return fallback;

  const row = data as {
    razon_social: string | null;
    ruc: string | null;
    kude_logo_path: string | null;
    kude_color_primario: string | null;
    kude_color_primario_fill: string | null;
  };

  const colorPrimario = row.kude_color_primario?.trim() || null;
  const colorPrimarioFill = row.kude_color_primario_fill?.trim() || null;

  let logoBytes: Uint8Array | null = null;
  const logoPath = row.kude_logo_path?.trim() || null;
  if (logoPath) {
    const dl = await downloadSifenObject(supabase, logoPath).catch(() => null);
    if (dl && dl.ok) logoBytes = new Uint8Array(dl.data);
  }

  const branding: ReciboBranding | null =
    logoBytes || colorPrimario || colorPrimarioFill ? { logoBytes, colorPrimario, colorPrimarioFill } : null;

  return {
    nombre: row.razon_social?.trim() || "Neura",
    ruc: row.ruc?.trim() || null,
    branding,
  };
}

/**
 * GET /api/pagos/[id]/recibo
 * Recibo de dinero (PDF) de un pago YA confirmado (incluye pagos parciales).
 * Query: `download=1` → Content-Disposition attachment.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getFacturasSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { auth, supabase } = ctx;

    const { id } = await params;
    const pagoId = (id ?? "").trim();
    if (!pagoId) return NextResponse.json(errorResponse("id de pago es obligatorio"), { status: 400 });

    const download = request.nextUrl.searchParams.get("download") === "1";

    // Pago confirmado (no revertido: una transferencia anulada no es dinero cobrado).
    const { data: pago, error: errPago } = await supabase
      .from("pagos")
      .select("id, factura_id, cliente_id, monto, fecha_pago, metodo_pago, referencia, recibo_nro, estado_contable")
      .eq("id", pagoId)
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();
    if (errPago) return NextResponse.json(errorResponse(errPago.message), { status: 400 });
    if (!pago) return NextResponse.json(errorResponse("Pago no encontrado."), { status: 404 });
    if (String(pago.estado_contable ?? "") === "revertido") {
      return NextResponse.json(
        errorResponse("Este pago fue revertido (transferencia anulada); no corresponde emitir recibo."),
        { status: 409 }
      );
    }

    const facturaId = pago.factura_id == null ? "" : String(pago.factura_id);
    const { data: factura, error: errFac } = await supabase
      .from("facturas")
      .select("numero_factura, monto, saldo, moneda, tipo")
      .eq("id", facturaId)
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();
    if (errFac) return NextResponse.json(errorResponse(errFac.message), { status: 400 });
    if (!factura) return NextResponse.json(errorResponse("Factura del pago no encontrada."), { status: 404 });

    // Cliente (nombre display + doc fiscal).
    let clienteNombre = "Cliente";
    let clienteDoc: string | null = null;
    const clienteId = pago.cliente_id == null ? "" : String(pago.cliente_id);
    if (clienteId) {
      const { data: cli } = await supabase
        .from("clientes")
        .select("tipo_cliente, empresa, nombre_contacto, nombre, razon_social, ruc_factura, ruc, documento")
        .eq("id", clienteId)
        .eq("empresa_id", auth.empresa_id)
        .maybeSingle();
      if (cli) {
        clienteNombre = nombreClienteDisplay(cli as Record<string, unknown>, "Cliente");
        const c = cli as { ruc_factura?: string | null; ruc?: string | null; documento?: string | null };
        clienteDoc = c.ruc_factura?.trim() || c.ruc?.trim() || c.documento?.trim() || null;
      }
    }

    const moneda: "GS" | "USD" = String(factura.moneda) === "USD" ? "USD" : "GS";

    // Correlativo (lazy, atómico). Drift-safe → provisional si el schema no lo soporta.
    const schema = await fetchDataSchemaForEmpresaId(auth.empresa_id).catch(() => "");
    let reciboNro: number | null = pago.recibo_nro == null ? null : Number(pago.recibo_nro);
    if (schema) {
      const asignado = await asignarReciboNumero(schema, auth.empresa_id, pagoId);
      if (asignado != null) reciboNro = asignado;
    }

    const emisorInfo = await loadEmisorYBranding(supabase, auth.empresa_id).catch(() => ({
      nombre: "Neura",
      ruc: null as string | null,
      branding: null as ReciboBranding | null,
    }));

    const pdf = await buildReciboPdfBuffer({
      reciboNro,
      emisor: { nombre: emisorInfo.nombre, ruc: emisorInfo.ruc },
      cliente: { nombre: clienteNombre, doc: clienteDoc },
      pago: {
        monto: Number(pago.monto),
        moneda,
        fecha: String(pago.fecha_pago),
        metodo: String(pago.metodo_pago ?? "efectivo"),
        referencia: pago.referencia == null ? null : String(pago.referencia),
      },
      factura: {
        numero: factura.numero_factura == null ? "" : String(factura.numero_factura),
        tipo: factura.tipo == null ? null : String(factura.tipo),
        total: Number(factura.monto),
        saldoRestante: Number(factura.saldo),
      },
      branding: emisorInfo.branding,
    });

    const fname = `Recibo-${formatReciboNro(reciboNro)}.pdf`;
    const disp = download ? `attachment; filename="${fname}"` : `inline; filename="${fname}"`;

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": disp,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
