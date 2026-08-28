import { NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api/response";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { requireAyudaApiAccess } from "@/lib/ayuda/ayuda-auth";
import { listArticulos, puedeVerArticulo } from "@/lib/ayuda/ayuda";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ slug: string }> };

/** Artículo completo por slug. Suma una vista y devuelve el feedback ya dado por el usuario. */
export async function GET(request: Request, context: RouteContext) {
  try {
    const auth = await requireAyudaApiAccess(request);
    if (!auth.ok) {
      return NextResponse.json(errorResponse(auth.message), { status: auth.status });
    }
    const { slug } = await context.params;

    const supabase = await getChatServiceClientForEmpresa(auth.empresaId);
    const articulos = await listArticulos(supabase, auth.empresaId);
    const articulo = articulos.find((a) => a.slug === slug);

    if (!articulo || !puedeVerArticulo(articulo, auth.rol, auth.esAdmin)) {
      return NextResponse.json(errorResponse("Artículo no encontrado"), { status: 404 });
    }

    /** Contador informativo: un update simple alcanza, no vale bloquear por una vista perdida. */
    if (!auth.esAdmin) {
      await supabase
        .from("ayuda_articulos")
        .update({ vistas: (articulo.vistas ?? 0) + 1 })
        .eq("empresa_id", auth.empresaId)
        .eq("id", articulo.id);
    }

    let miFeedback: boolean | null = null;
    if (auth.usuarioCatalogId) {
      const { data: fb } = await supabase
        .from("ayuda_articulo_feedback")
        .select("util")
        .eq("empresa_id", auth.empresaId)
        .eq("articulo_id", articulo.id)
        .eq("usuario_id", auth.usuarioCatalogId)
        .limit(1);
      const row = (fb ?? [])[0] as { util: boolean } | undefined;
      miFeedback = row ? row.util : null;
    }

    /** Documentos descargables del artículo (contrato modelo, planillas, instructivos…). */
    const { data: adjData } = await supabase
      .from("ayuda_articulo_adjuntos")
      .select("id, nombre, mime_type, size_bytes, orden, created_at")
      .eq("empresa_id", auth.empresaId)
      .eq("articulo_id", articulo.id)
      .order("orden", { ascending: true });
    const adjuntos = adjData ?? [];

    /** Relacionados: misma categoría, para que el asesor siga leyendo lo que corresponde. */
    const relacionados = articulos
      .filter(
        (a) =>
          a.id !== articulo.id &&
          a.categoria_id &&
          a.categoria_id === articulo.categoria_id &&
          puedeVerArticulo(a, auth.rol, auth.esAdmin)
      )
      .slice(0, 5)
      .map((a) => ({ id: a.id, slug: a.slug, titulo: a.titulo }));

    return NextResponse.json(
      successResponse({
        articulo,
        adjuntos,
        relacionados,
        mi_feedback: miFeedback,
        meta: { can_edit: auth.esAdmin },
      })
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo cargar el artículo";
    return NextResponse.json(errorResponse(message), { status: 500 });
  }
}
