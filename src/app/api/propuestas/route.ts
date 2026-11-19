import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requirePropuestasAcceso } from "@/lib/propuestas/auth";
import { CAMPOS_PROPUESTA, datosDePropuesta } from "@/lib/propuestas/servidor";

/** GET /api/propuestas → las propuestas guardadas, la más nueva primero. */
export async function GET(request: Request) {
  const auth = await requirePropuestasAcceso(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  const sb = await getChatServiceClientForEmpresa(auth.empresaId);
  const { data, error } = await sb
    .from("propuestas")
    .select(CAMPOS_PROPUESTA)
    .eq("empresa_id", auth.empresaId)
    .eq("archivada", false)
    .order("updated_at", { ascending: false })
    .limit(300);
  if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
  return NextResponse.json(successResponse(data ?? []));
}

/** POST /api/propuestas → guardar una propuesta nueva. */
export async function POST(request: Request) {
  const auth = await requirePropuestasAcceso(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  const datos = datosDePropuesta((await request.json().catch(() => ({}))) as Record<string, unknown>);
  if (!datos.titulo) return NextResponse.json(errorResponse("Poné el título de la propuesta"), { status: 400 });
  const sb = await getChatServiceClientForEmpresa(auth.empresaId);
  const { data, error } = await sb
    .from("propuestas")
    .insert({ ...datos, empresa_id: auth.empresaId, created_by: auth.usuarioId })
    .select(CAMPOS_PROPUESTA)
    .single();
  if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
  return NextResponse.json(successResponse(data), { status: 201 });
}
