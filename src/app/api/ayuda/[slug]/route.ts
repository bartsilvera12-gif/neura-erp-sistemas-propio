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

    /**
     * Relacionados para la columna lateral del lector.
     *
     * Primero los de la MISMA categoría, que es lo que de verdad ayuda a seguir
     * leyendo. Si el artículo está solo en su categoría, se cae al resto de la
     * base en vez de dejar la columna vacía: una barra lateral en blanco parece
     * un error, y el que entró buscando algo igual necesita a dónde ir.
     */
    const visibles = articulos.filter(
      (a) => a.id !== articulo.id && puedeVerArticulo(a, auth.rol, auth.esAdmin)
    );
    const mismaCategoria = visibles.filter(
      (a) => a.categoria_id && a.categoria_id === articulo.categoria_id
    );
    const usaCategoria = mismaCategoria.length > 0;
    const relacionados = (usaCategoria ? mismaCategoria : visibles)
      .slice(0, 12)
      .map((a) => ({
        id: a.id,
        slug: a.slug,
        titulo: a.titulo,
        categoria_nombre: a.categoria_nombre,
      }));

    return NextResponse.json(
      successResponse({
        articulo,
        adjuntos,
        relacionados,
        /** De dónde salió la lista lateral, para poder titularla bien. */
        relacionados_origen: usaCategoria ? "categoria" : "otros",
        mi_feedback: miFeedback,
        meta: { can_edit: auth.esAdmin },
      })
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo cargar el artículo";
    return NextResponse.json(errorResponse(message), { status: 500 });
  }
}
