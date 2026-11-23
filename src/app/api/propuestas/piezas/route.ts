import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requirePropuestasAcceso, texto } from "@/lib/propuestas/auth";

const CAMPOS = "id, seccion, titulo, descripcion, sort_order";

/** GET /api/propuestas/piezas → el catálogo de piezas activas, por sección. */
export async function GET(request: Request) {
  const auth = await requirePropuestasAcceso(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  const sb = await getChatServiceClientForEmpresa(auth.empresaId);
  const { data, error } = await sb
    .from("propuesta_piezas")
    .select(CAMPOS)
    .eq("empresa_id", auth.empresaId)
    .eq("activo", true)
    .order("sort_order", { ascending: true })
    .order("titulo", { ascending: true })
    .limit(2000);
  if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
  return NextResponse.json(successResponse(data ?? []));
}

/** POST /api/propuestas/piezas → nueva pieza del catálogo. */
export async function POST(request: Request) {
  const auth = await requirePropuestasAcceso(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const seccion = texto(body.seccion, 80);
  const titulo = texto(body.titulo, 120);
  const descripcion = texto(body.descripcion, 300);
  if (!seccion) return NextResponse.json(errorResponse("Elegí o escribí la sección"), { status: 400 });
  if (!titulo) return NextResponse.json(errorResponse("Poné el título de la pieza"), { status: 400 });

  const sb = await getChatServiceClientForEmpresa(auth.empresaId);
  // Va al final de su sección.
  const { data: ult } = await sb
    .from("propuesta_piezas")
    .select("sort_order")
    .eq("empresa_id", auth.empresaId)
    .order("sort_order", { ascending: false })
    .limit(1);
  const siguiente = ((ult?.[0] as { sort_order?: number } | undefined)?.sort_order ?? 0) + 10;
  const { data, error } = await sb
    .from("propuesta_piezas")
    .insert({ empresa_id: auth.empresaId, seccion, titulo, descripcion, sort_order: siguiente, created_by: auth.usuarioId })
    .select(CAMPOS)
    .single();
  if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
  return NextResponse.json(successResponse(data), { status: 201 });
}
