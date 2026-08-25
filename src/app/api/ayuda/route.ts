import { NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api/response";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { requireAyudaApiAccess } from "@/lib/ayuda/ayuda-auth";
import {
  listArticulos,
  listCategorias,
  matchesBusqueda,
  puedeVerArticulo,
  stripContenido,
} from "@/lib/ayuda/ayuda";

export const runtime = "nodejs";

/**
 * Listado del lector (`/ayuda`): categorías + artículos visibles para el rol del
 * usuario, sin el cuerpo del artículo. `?q=` busca también dentro del texto.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireAyudaApiAccess(request);
    if (!auth.ok) {
      return NextResponse.json(errorResponse(auth.message), { status: auth.status });
    }

    const url = new URL(request.url);
    const q = url.searchParams.get("q") ?? "";
    const modulo = url.searchParams.get("modulo");

    const supabase = await getChatServiceClientForEmpresa(auth.empresaId);
    const [articulos, categorias] = await Promise.all([
      listArticulos(supabase, auth.empresaId),
      listCategorias(supabase, auth.empresaId),
    ]);

    const visibles = articulos
      .filter((a) => puedeVerArticulo(a, auth.rol, auth.esAdmin))
      .filter((a) => (modulo ? a.modulo === modulo : true))
      .filter((a) => matchesBusqueda(a, q));

    const conArticulos = new Set(visibles.map((a) => a.categoria_id).filter(Boolean) as string[]);

    return NextResponse.json(
      successResponse({
        articulos: visibles.map(stripContenido),
        categorias: categorias
          .filter((c) => c.activo)
          .map((c) => ({ ...c, articulos: visibles.filter((a) => a.categoria_id === c.id).length })),
        meta: {
          can_edit: auth.esAdmin,
          rol: auth.rol,
          categorias_con_articulos: conArticulos.size,
        },
      })
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo cargar la Ayuda en línea";
    return NextResponse.json(errorResponse(message), { status: 500 });
  }
}
