import { NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api/response";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { requireAyudaAdminAccess } from "@/lib/ayuda/ayuda-auth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Historial de un artículo (últimas 20 versiones, más nueva primero).
 * Restaurar = el editor carga el texto viejo en el campo y guarda: así la vuelta
 * atrás también queda registrada como una versión más.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const auth = await requireAyudaAdminAccess(request);
    if (!auth.ok) {
      return NextResponse.json(errorResponse(auth.message), { status: auth.status });
    }
    const { id } = await context.params;
    const supabase = await getChatServiceClientForEmpresa(auth.empresaId);

    const { data, error } = await supabase
      .from("ayuda_articulo_versiones")
      .select("id, titulo, contenido_md, guardado_por, created_at")
      .eq("empresa_id", auth.empresaId)
      .eq("articulo_id", id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    return NextResponse.json(successResponse({ versiones: data ?? [] }));
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo cargar el historial";
    return NextResponse.json(errorResponse(message), { status: 500 });
  }
}
