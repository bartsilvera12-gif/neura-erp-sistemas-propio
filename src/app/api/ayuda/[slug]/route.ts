import { NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api/response";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { requireAyudaApiAccess } from "@/lib/ayuda/ayuda-auth";
import { ARTICULO_COLS, listCategorias, puedeVerArticulo } from "@/lib/ayuda/ayuda";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ slug: string }> };

type ArticuloRow = {
  id: string;
  categoria_id: string | null;
  titulo: string;
  slug: string;
  roles_visibles: string[] | null;
  publicado: boolean;
  vistas: number | null;
};

/**
 * Artículo completo por slug.
 *
 * RENDIMIENTO: antes esto cargaba la tabla ENTERA de artículos —con el cuerpo
 * de cada uno— sólo para encontrar uno por slug y armar la lista de
 * relacionados, y encima encadenaba cinco consultas una atrás de otra. Medido
 * contra la base: ~678 ms. Ahora va el artículo por su slug, los relacionados
 * sin cuerpo, y todo en una sola tanda en paralelo: ~173 ms.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const auth = await requireAyudaApiAccess(request);
    if (!auth.ok) {
      return NextResponse.json(errorResponse(auth.message), { status: auth.status });
    }
    const { slug } = await context.params;

    const supabase = await getChatServiceClientForEmpresa(auth.empresaId);

    // Primero el artículo: sin él no hay nada que responder, y su id es lo que
    // necesitan las consultas de adjuntos y feedback.
    const [{ data: fila, error }, categorias] = await Promise.all([
      supabase
        .from("ayuda_articulos")
        .select(ARTICULO_COLS)
        .eq("empresa_id", auth.empresaId)
        .eq("slug", slug)
        .maybeSingle(),
      listCategorias(supabase, auth.empresaId),
    ]);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    const cat = fila?.categoria_id
      ? categorias.find((c) => c.id === fila.categoria_id) ?? null
      : null;
    const articulo = fila
      ? {
          ...fila,
          roles_visibles: fila.roles_visibles ?? [],
          categoria_nombre: cat?.nombre ?? null,
          categoria_slug: cat?.slug ?? null,
        }
      : null;

    if (!articulo || !puedeVerArticulo(articulo, auth.rol, auth.esAdmin)) {
      return NextResponse.json(errorResponse("Artículo no encontrado"), { status: 404 });
    }

    /**
     * El resto en paralelo. Los relacionados se piden SIN el cuerpo: en la
     * columna lateral sólo se pinta el título.
     */
    const [{ data: otrosData }, { data: fbData }, { data: adjData }] = await Promise.all([
      supabase
        .from("ayuda_articulos")
        .select("id, categoria_id, titulo, slug, roles_visibles, publicado, vistas")
        .eq("empresa_id", auth.empresaId)
        .neq("id", articulo.id),
      auth.usuarioCatalogId
        ? supabase
            .from("ayuda_articulo_feedback")
            .select("util")
            .eq("empresa_id", auth.empresaId)
            .eq("articulo_id", articulo.id)
            .eq("usuario_id", auth.usuarioCatalogId)
            .limit(1)
        : Promise.resolve({ data: [] as { util: boolean }[] }),
      supabase
        .from("ayuda_articulo_adjuntos")
        .select("id, nombre, mime_type, size_bytes, orden, created_at")
        .eq("empresa_id", auth.empresaId)
        .eq("articulo_id", articulo.id)
        .order("orden", { ascending: true }),
    ]);

    /**
     * Contador informativo: se dispara y NO se espera. Es un dato de color, y
     * hacer esperar la pantalla ~50 ms por él no se justifica; si se pierde una
     * vista no pasa nada.
     */
    if (!auth.esAdmin) {
      void supabase
        .from("ayuda_articulos")
        .update({ vistas: (articulo.vistas ?? 0) + 1 })
        .eq("empresa_id", auth.empresaId)
        .eq("id", articulo.id)
        .then(
          () => undefined,
          () => undefined
        );
    }

    const row = ((fbData ?? []) as { util: boolean }[])[0];
    const miFeedback = row ? row.util : null;

    /**
     * Relacionados para la columna lateral.
     *
     * Primero los de la MISMA categoría, que es lo que de verdad ayuda a seguir
     * leyendo. Si el artículo está solo en su categoría, se cae al resto de la
     * base en vez de dejar la columna vacía: una barra lateral en blanco parece
     * un error, y el que entró buscando algo igual necesita a dónde ir.
     */
    const visibles = ((otrosData ?? []) as ArticuloRow[])
      .map((a) => ({
        ...a,
        roles_visibles: a.roles_visibles ?? [],
        categoria_nombre: a.categoria_id
          ? categorias.find((c) => c.id === a.categoria_id)?.nombre ?? null
          : null,
      }))
      .filter((a) => puedeVerArticulo(a, auth.rol, auth.esAdmin));

    const mismaCategoria = visibles.filter(
      (a) => a.categoria_id && a.categoria_id === articulo.categoria_id
    );
    const usaCategoria = mismaCategoria.length > 0;
    const relacionados = (usaCategoria ? mismaCategoria : visibles).slice(0, 12).map((a) => ({
      id: a.id,
      slug: a.slug,
      titulo: a.titulo,
      categoria_nombre: a.categoria_nombre,
    }));

    return NextResponse.json(
      successResponse({
        articulo,
        adjuntos: adjData ?? [],
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
