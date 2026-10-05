import { NextRequest, NextResponse } from "next/server";
import { getFacturasSupabaseFromAuth } from "@/lib/facturacion/facturas-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

export const runtime = "nodejs";

/**
 * POST /api/caja/cliente-por-ruc
 * Busca un cliente por RUC (ruc_factura / ruc / documento) en la empresa; si no existe, lo crea
 * con los datos mínimos para facturar (razón social + RUC). Devuelve el cliente_id.
 * Pensado para la Caja de facturación rápida.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getFacturasSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { auth, supabase } = ctx;

    const body = (await request.json().catch(() => ({}))) as { nombre?: unknown; ruc?: unknown };
    const nombre = typeof body.nombre === "string" ? body.nombre.trim() : "";
    const ruc = typeof body.ruc === "string" ? body.ruc.trim() : "";
    if (!nombre) return NextResponse.json(errorResponse("Indicá el nombre o razón social."), { status: 400 });
    if (!ruc) return NextResponse.json(errorResponse("Indicá el RUC."), { status: 400 });

    // 1) Buscar por RUC (fiscal, genérico o documento).
    const { data: existentes, error: errBuscar } = await supabase
      .from("clientes")
      .select("id")
      .eq("empresa_id", auth.empresa_id)
      .or(`ruc_factura.eq.${ruc},ruc.eq.${ruc},documento.eq.${ruc}`)
      .limit(1);
    if (errBuscar) return NextResponse.json(errorResponse(errBuscar.message), { status: 400 });
    if (existentes && existentes.length > 0) {
      return NextResponse.json(successResponse({ cliente_id: String(existentes[0]!.id), creado: false }));
    }

    // 2) Crear cliente mínimo para facturar.
    const insert: Record<string, unknown> = {
      empresa_id: auth.empresa_id,
      tipo_cliente: "empresa",
      razon_social: nombre,
      ruc_factura: ruc,
      ruc,
      empresa: nombre,
      nombre,
      nombre_contacto: nombre,
      created_by_user_id: auth.user?.id ?? null,
      origen: "CAJA",
      estado: "activo",
      moneda_preferida: "GS",
    };
    const { data: creado, error: errCrear } = await supabase
      .from("clientes")
      .insert([insert])
      .select("id")
      .single();
    if (errCrear || !creado?.id) {
      return NextResponse.json(errorResponse(errCrear?.message ?? "No se pudo crear el cliente"), { status: 400 });
    }

    return NextResponse.json(successResponse({ cliente_id: String(creado.id), creado: true }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
