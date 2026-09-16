import { NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api/response";
import { CONTACTO_CAMPOS, contextoContactos, leerContacto } from "@/lib/clientes/contactos";

type Params = { params: Promise<{ id: string }> };

/** GET /api/clientes/:id/contactos — contactos secundarios del cliente. */
export async function GET(request: Request, { params }: Params) {
  try {
    const ctx = await contextoContactos(request, (await params).id);
    if (!ctx.ok) return NextResponse.json(errorResponse(ctx.mensaje), { status: ctx.status });
    const { data, error } = await ctx.sb
      .from("cliente_contactos")
      .select(CONTACTO_CAMPOS)
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("cliente_id", ctx.clienteId)
      .order("nombre");
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    return NextResponse.json(successResponse(data ?? []));
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error inesperado"), { status: 500 });
  }
}

/** POST /api/clientes/:id/contactos — agrega un contacto secundario. */
export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await contextoContactos(request, (await params).id);
    if (!ctx.ok) return NextResponse.json(errorResponse(ctx.mensaje), { status: ctx.status });
    const leido = leerContacto((await request.json().catch(() => null)) as Record<string, unknown> | null);
    if (!leido.ok) return NextResponse.json(errorResponse(leido.mensaje), { status: 400 });
    const { data, error } = await ctx.sb
      .from("cliente_contactos")
      .insert({
        ...leido.datos,
        empresa_id: ctx.auth.empresa_id,
        cliente_id: ctx.clienteId,
        created_by: ctx.auth.usuarioCatalogId ?? null,
        updated_by: ctx.auth.usuarioCatalogId ?? null,
      })
      .select(CONTACTO_CAMPOS)
      .single();
    if (error || !data) return NextResponse.json(errorResponse(error?.message ?? "No se pudo guardar"), { status: 400 });
    return NextResponse.json(successResponse(data));
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error inesperado"), { status: 500 });
  }
}
