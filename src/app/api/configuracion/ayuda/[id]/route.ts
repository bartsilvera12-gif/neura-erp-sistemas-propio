import { NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api/response";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { requireAyudaAdminAccess } from "@/lib/ayuda/ayuda-auth";
import {
  ARTICULO_COLS,
  AyudaValidationError,
  parseArticuloUpdate,
  uniqueSlug,
  type AyudaArticuloRow,
} from "@/lib/ayuda/ayuda";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

async function findArticulo(
  supabase: Awaited<ReturnType<typeof getChatServiceClientForEmpresa>>,
  empresaId: string,
  id: string
): Promise<AyudaArticuloRow | null> {
  const { data, error } = await supabase
    .from("ayuda_articulos")
    .select(ARTICULO_COLS)
    .eq("empresa_id", empresaId)
    .eq("id", id)
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as AyudaArticuloRow | undefined) ?? null;
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await requireAyudaAdminAccess(request);
    if (!auth.ok) {
      return NextResponse.json(errorResponse(auth.message), { status: auth.status });
    }
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const patch = parseArticuloUpdate(body);
    if (Object.keys(patch).length === 0) {
      return NextResponse.json(errorResponse("No hay cambios para aplicar."), { status: 400 });
    }

    const supabase = await getChatServiceClientForEmpresa(auth.empresaId);
    const actual = await findArticulo(supabase, auth.empresaId, id);
    if (!actual) {
      return NextResponse.json(errorResponse("Artículo no encontrado"), { status: 404 });
    }

    /**
     * Snapshot del texto ANTERIOR antes de pisarlo. Sin esto, un pegado mal hecho
     * borra la redacción sin vuelta atrás — y quien carga no es programador.
     */
    const cambiaTexto =
      (patch.contenido_md !== undefined && patch.contenido_md !== actual.contenido_md) ||
      (patch.titulo !== undefined && patch.titulo !== actual.titulo);
    if (cambiaTexto) {
      const { error: verErr } = await supabase.from("ayuda_articulo_versiones").insert({
        empresa_id: auth.empresaId,
        articulo_id: actual.id,
        titulo: actual.titulo,
        contenido_md: actual.contenido_md ?? "",
        guardado_por: auth.usuarioCatalogId,
      });
      if (verErr) {
        console.error("[ayuda] no se pudo guardar la versión previa:", verErr.message);
      }
    }

    const update: Record<string, unknown> = { actualizado_por: auth.usuarioCatalogId };
    if (patch.titulo !== undefined) update.titulo = patch.titulo;
    if (patch.resumen !== undefined) update.resumen = patch.resumen;
    if (patch.contenido_md !== undefined) update.contenido_md = patch.contenido_md;
    if (patch.categoria_id !== undefined) update.categoria_id = patch.categoria_id;
    if (patch.modulo !== undefined) update.modulo = patch.modulo;
    if (patch.roles_visibles !== undefined) update.roles_visibles = patch.roles_visibles;
    if (patch.orden !== undefined) update.orden = patch.orden;
    if (patch.publicado !== undefined) update.publicado = patch.publicado;

    if (patch.slug !== undefined && patch.slug !== null) {
      const { data: todos } = await supabase
        .from("ayuda_articulos")
        .select("id, slug")
        .eq("empresa_id", auth.empresaId);
      const tomados = new Set(
        ((todos ?? []) as { id: string; slug: string }[])
          .filter((r) => r.id !== actual.id)
          .map((r) => r.slug)
      );
      update.slug = uniqueSlug(patch.slug, tomados);
    }

    const { data, error } = await supabase
      .from("ayuda_articulos")
      .update(update)
      .eq("empresa_id", auth.empresaId)
      .eq("id", actual.id)
      .select("*")
      .single();

    if (error) {
      const status = error.code === "23505" ? 409 : 400;
      return NextResponse.json(errorResponse(error.message), { status });
    }
    return NextResponse.json(successResponse({ articulo: data }));
  } catch (e) {
    if (e instanceof AyudaValidationError) {
      return NextResponse.json(errorResponse(e.message), { status: e.status });
    }
    const message = e instanceof Error ? e.message : "No se pudo actualizar el artículo";
    return NextResponse.json(errorResponse(message), { status: 400 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const auth = await requireAyudaAdminAccess(request);
    if (!auth.ok) {
      return NextResponse.json(errorResponse(auth.message), { status: auth.status });
    }
    const { id } = await context.params;
    const supabase = await getChatServiceClientForEmpresa(auth.empresaId);
    const actual = await findArticulo(supabase, auth.empresaId, id);
    if (!actual) {
      return NextResponse.json(errorResponse("Artículo no encontrado"), { status: 404 });
    }

    const { error } = await supabase
      .from("ayuda_articulos")
      .delete()
      .eq("empresa_id", auth.empresaId)
      .eq("id", actual.id);
    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    return NextResponse.json(successResponse({ eliminado: actual.id }));
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo eliminar el artículo";
    return NextResponse.json(errorResponse(message), { status: 400 });
  }
}
