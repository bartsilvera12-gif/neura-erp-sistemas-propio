import { NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api/response";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { requireAyudaAdminAccess } from "@/lib/ayuda/ayuda-auth";
import {
  AyudaValidationError,
  listArticulos,
  listCategorias,
  normalizeRolAyuda,
  parseArticuloCreate,
  summarize,
  uniqueSlug,
} from "@/lib/ayuda/ayuda";

export const runtime = "nodejs";

/** Roles reales de la empresa: las casillas de visibilidad se arman con esto, no con una lista fija. */
async function rolesDeLaEmpresa(empresaId: string): Promise<string[]> {
  try {
    const catalog = createServiceRoleClient();
    const { data } = await catalog.from("usuarios").select("rol").eq("empresa_id", empresaId);
    const roles = new Set<string>();
    for (const r of (data ?? []) as { rol: string | null }[]) {
      const n = normalizeRolAyuda(r.rol);
      if (n) roles.add(n);
    }
    return Array.from(roles).sort();
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  try {
    const auth = await requireAyudaAdminAccess(request);
    if (!auth.ok) {
      return NextResponse.json(errorResponse(auth.message), { status: auth.status });
    }
    const supabase = await getChatServiceClientForEmpresa(auth.empresaId);
    const [articulos, categorias, roles] = await Promise.all([
      listArticulos(supabase, auth.empresaId),
      listCategorias(supabase, auth.empresaId),
      rolesDeLaEmpresa(auth.empresaId),
    ]);

    const { data: fbData } = await supabase
      .from("ayuda_articulo_feedback")
      .select("articulo_id, util")
      .eq("empresa_id", auth.empresaId);

    const feedback: Record<string, { util: number; no_util: number }> = {};
    for (const f of (fbData ?? []) as { articulo_id: string; util: boolean }[]) {
      const acc = feedback[f.articulo_id] ?? { util: 0, no_util: 0 };
      if (f.util) acc.util += 1;
      else acc.no_util += 1;
      feedback[f.articulo_id] = acc;
    }

    return NextResponse.json(
      successResponse({
        articulos,
        categorias,
        feedback,
        summary: summarize(articulos, categorias),
        meta: { can_edit: true, roles_disponibles: roles },
      })
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo cargar la Ayuda en línea";
    return NextResponse.json(errorResponse(message), { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAyudaAdminAccess(request);
    if (!auth.ok) {
      return NextResponse.json(errorResponse(auth.message), { status: auth.status });
    }
    const body = await request.json().catch(() => ({}));
    const create = parseArticuloCreate(body);

    const supabase = await getChatServiceClientForEmpresa(auth.empresaId);
    const existentes = await listArticulos(supabase, auth.empresaId);
    const slug = uniqueSlug(
      create.slug ?? create.titulo,
      new Set(existentes.map((a) => a.slug))
    );

    const { data, error } = await supabase
      .from("ayuda_articulos")
      .insert({
        empresa_id: auth.empresaId,
        categoria_id: create.categoria_id,
        titulo: create.titulo,
        slug,
        resumen: create.resumen,
        contenido_md: create.contenido_md,
        modulo: create.modulo,
        roles_visibles: create.roles_visibles,
        orden: create.orden,
        publicado: create.publicado,
        creado_por: auth.usuarioCatalogId,
        actualizado_por: auth.usuarioCatalogId,
      })
      .select("*")
      .single();

    if (error) {
      const status = error.code === "23505" ? 409 : 400;
      return NextResponse.json(errorResponse(error.message), { status });
    }
    return NextResponse.json(successResponse({ articulo: data }), { status: 201 });
  } catch (e) {
    if (e instanceof AyudaValidationError) {
      return NextResponse.json(errorResponse(e.message), { status: e.status });
    }
    const message = e instanceof Error ? e.message : "No se pudo crear el artículo";
    return NextResponse.json(errorResponse(message), { status: 400 });
  }
}
