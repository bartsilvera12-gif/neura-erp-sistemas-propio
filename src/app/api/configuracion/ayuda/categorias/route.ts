import { NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api/response";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { requireAyudaAdminAccess } from "@/lib/ayuda/ayuda-auth";
import {
  AyudaValidationError,
  listCategorias,
  parseCategoriaCreate,
  uniqueSlug,
} from "@/lib/ayuda/ayuda";

export const runtime = "nodejs";

/** Alta de categoría desde el propio editor: quien carga no debería tener que pedirla. */
export async function POST(request: Request) {
  try {
    const auth = await requireAyudaAdminAccess(request);
    if (!auth.ok) {
      return NextResponse.json(errorResponse(auth.message), { status: auth.status });
    }
    const body = await request.json().catch(() => ({}));
    const create = parseCategoriaCreate(body);

    const supabase = await getChatServiceClientForEmpresa(auth.empresaId);
    const existentes = await listCategorias(supabase, auth.empresaId);

    const duplicada = existentes.find(
      (c) => c.nombre.trim().toLowerCase() === create.nombre.trim().toLowerCase()
    );
    if (duplicada) {
      return NextResponse.json(successResponse({ categoria: duplicada, ya_existia: true }));
    }

    const slug = uniqueSlug(
      create.slug ?? create.nombre,
      new Set(existentes.map((c) => c.slug)),
      "categoria"
    );
    const orden =
      create.orden || (existentes.reduce((max, c) => Math.max(max, c.orden), 0) + 10);

    const { data, error } = await supabase
      .from("ayuda_categorias")
      .insert({
        empresa_id: auth.empresaId,
        nombre: create.nombre,
        slug,
        descripcion: create.descripcion,
        orden,
        activo: create.activo,
      })
      .select("*")
      .single();

    if (error) {
      const status = error.code === "23505" ? 409 : 400;
      return NextResponse.json(errorResponse(error.message), { status });
    }
    return NextResponse.json(successResponse({ categoria: data }), { status: 201 });
  } catch (e) {
    if (e instanceof AyudaValidationError) {
      return NextResponse.json(errorResponse(e.message), { status: e.status });
    }
    const message = e instanceof Error ? e.message : "No se pudo crear la categoría";
    return NextResponse.json(errorResponse(message), { status: 400 });
  }
}
