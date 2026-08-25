import { NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api/response";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { requireAyudaApiAccess } from "@/lib/ayuda/ayuda-auth";
import { listArticulos, puedeVerArticulo } from "@/lib/ayuda/ayuda";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ slug: string }> };

/**
 * "¿Te sirvió?" del lector. Un voto por usuario y artículo: si ya votó, se pisa.
 * Es la señal barata que dice qué proceso está mal documentado.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireAyudaApiAccess(request);
    if (!auth.ok) {
      return NextResponse.json(errorResponse(auth.message), { status: auth.status });
    }
    if (!auth.usuarioCatalogId) {
      return NextResponse.json(errorResponse("Usuario sin ficha en el catálogo"), { status: 403 });
    }

    const { slug } = await context.params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.util !== "boolean") {
      return NextResponse.json(errorResponse('El campo "util" debe ser true o false.'), { status: 400 });
    }
    const comentario =
      typeof body.comentario === "string" && body.comentario.trim() ? body.comentario.trim() : null;

    const supabase = await getChatServiceClientForEmpresa(auth.empresaId);
    const articulo = (await listArticulos(supabase, auth.empresaId)).find((a) => a.slug === slug);
    if (!articulo || !puedeVerArticulo(articulo, auth.rol, auth.esAdmin)) {
      return NextResponse.json(errorResponse("Artículo no encontrado"), { status: 404 });
    }

    const { data: existente } = await supabase
      .from("ayuda_articulo_feedback")
      .select("id")
      .eq("empresa_id", auth.empresaId)
      .eq("articulo_id", articulo.id)
      .eq("usuario_id", auth.usuarioCatalogId)
      .limit(1);

    const previo = (existente ?? [])[0] as { id: string } | undefined;

    const { error } = previo
      ? await supabase
          .from("ayuda_articulo_feedback")
          .update({ util: body.util, comentario })
          .eq("empresa_id", auth.empresaId)
          .eq("id", previo.id)
      : await supabase.from("ayuda_articulo_feedback").insert({
          empresa_id: auth.empresaId,
          articulo_id: articulo.id,
          usuario_id: auth.usuarioCatalogId,
          util: body.util,
          comentario,
        });

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    return NextResponse.json(successResponse({ util: body.util }));
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo registrar el feedback";
    return NextResponse.json(errorResponse(message), { status: 500 });
  }
}
