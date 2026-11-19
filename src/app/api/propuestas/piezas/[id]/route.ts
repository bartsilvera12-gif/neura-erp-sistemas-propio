import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requirePropuestasAcceso, texto, UUID } from "@/lib/propuestas/auth";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH → editar el texto o la sección de una pieza. */
export async function PATCH(request: Request, ctx: Ctx) {
  const auth = await requirePropuestasAcceso(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json(errorResponse("Pieza inválida"), { status: 400 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("seccion" in body) patch.seccion = texto(body.seccion, 80);
  if ("titulo" in body) patch.titulo = texto(body.titulo, 120);
  if ("descripcion" in body) patch.descripcion = texto(body.descripcion, 300);
  if (patch.seccion === "" || patch.titulo === "") {
    return NextResponse.json(errorResponse("La sección y el título no pueden quedar vacíos"), { status: 400 });
  }
  const sb = await getChatServiceClientForEmpresa(auth.empresaId);
  const { data, error } = await sb
    .from("propuesta_piezas")
    .update(patch)
    .eq("empresa_id", auth.empresaId)
    .eq("id", id)
    .select("id, seccion, titulo, descripcion, sort_order")
    .single();
  if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
  return NextResponse.json(successResponse(data));
}

/** DELETE → la pieza sale del catálogo (no se borra: las propuestas viejas guardan su propio texto). */
export async function DELETE(request: Request, ctx: Ctx) {
  const auth = await requirePropuestasAcceso(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json(errorResponse("Pieza inválida"), { status: 400 });
  const sb = await getChatServiceClientForEmpresa(auth.empresaId);
  const { error } = await sb
    .from("propuesta_piezas")
    .update({ activo: false, updated_at: new Date().toISOString() })
    .eq("empresa_id", auth.empresaId)
    .eq("id", id);
  if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
  return NextResponse.json(successResponse({ id }));
}
