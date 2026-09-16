import { NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api/response";
import { CONTACTO_CAMPOS, contextoContactos, leerContacto } from "@/lib/clientes/contactos";

type Params = { params: Promise<{ id: string; contactoId: string }> };

/** PATCH /api/clientes/:id/contactos/:contactoId — edita un contacto. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id, contactoId } = await params;
    const ctx = await contextoContactos(request, id);
    if (!ctx.ok) return NextResponse.json(errorResponse(ctx.mensaje), { status: ctx.status });
    const leido = leerContacto((await request.json().catch(() => null)) as Record<string, unknown> | null);
    if (!leido.ok) return NextResponse.json(errorResponse(leido.mensaje), { status: 400 });
    const { data, error } = await ctx.sb
      .from("cliente_contactos")
      .update({ ...leido.datos, updated_by: ctx.auth.usuarioCatalogId ?? null, updated_at: new Date().toISOString() })
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("cliente_id", ctx.clienteId)
      .eq("id", contactoId)
      .select(CONTACTO_CAMPOS)
      .maybeSingle();
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    if (!data) return NextResponse.json(errorResponse("Contacto no encontrado"), { status: 404 });
    return NextResponse.json(successResponse(data));
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error inesperado"), { status: 500 });
  }
}

/** DELETE /api/clientes/:id/contactos/:contactoId — quita un contacto. */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const { id, contactoId } = await params;
    const ctx = await contextoContactos(request, id);
    if (!ctx.ok) return NextResponse.json(errorResponse(ctx.mensaje), { status: ctx.status });
    const { error } = await ctx.sb
      .from("cliente_contactos")
      .delete()
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("cliente_id", ctx.clienteId)
      .eq("id", contactoId);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    return NextResponse.json(successResponse({ eliminado: true }));
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error inesperado"), { status: 500 });
  }
}
