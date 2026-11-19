import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requirePropuestasAcceso, UUID } from "@/lib/propuestas/auth";
import { CAMPOS_PROPUESTA, datosDePropuesta } from "@/lib/propuestas/servidor";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH → guardar los cambios de una propuesta. */
export async function PATCH(request: Request, ctx: Ctx) {
  const auth = await requirePropuestasAcceso(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json(errorResponse("Propuesta inválida"), { status: 400 });
  const datos = datosDePropuesta((await request.json().catch(() => ({}))) as Record<string, unknown>);
  if (!datos.titulo) return NextResponse.json(errorResponse("Poné el título de la propuesta"), { status: 400 });
  const sb = await getChatServiceClientForEmpresa(auth.empresaId);
  const { data, error } = await sb
    .from("propuestas")
    .update({ ...datos, updated_at: new Date().toISOString() })
    .eq("empresa_id", auth.empresaId)
    .eq("id", id)
    .select(CAMPOS_PROPUESTA)
    .single();
  if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
  return NextResponse.json(successResponse(data));
}

/** DELETE → la propuesta se archiva (deja de aparecer en la lista). */
export async function DELETE(request: Request, ctx: Ctx) {
  const auth = await requirePropuestasAcceso(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json(errorResponse("Propuesta inválida"), { status: 400 });
  const sb = await getChatServiceClientForEmpresa(auth.empresaId);
  const { error } = await sb
    .from("propuestas")
    .update({ archivada: true, updated_at: new Date().toISOString() })
    .eq("empresa_id", auth.empresaId)
    .eq("id", id);
  if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
  return NextResponse.json(successResponse({ id }));
}
