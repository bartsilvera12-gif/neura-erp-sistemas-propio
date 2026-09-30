import { NextResponse } from "next/server";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";
import { errorResponse, successResponse } from "@/lib/api/response";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { requireTenantUserApiAccess } from "@/lib/contabilidad/contabilidad-auth";

export const runtime = "nodejs";

const SELECT_COLS = "id, empresa_id, parent_id, titulo, nombre_persona, orden, color, created_at, updated_at";

function esAdmin(rol: string | null): boolean {
  const r = String(rol ?? "").trim();
  return r === "super_admin" || esRolAdminEmpresaOGlobal(r);
}

/** ¿newParent es el propio nodo o un descendiente suyo? (evita ciclos al reasignar jefe). */
function crearíaCiclo(
  nodeId: string,
  newParentId: string,
  parentOf: Map<string, string | null>
): boolean {
  if (newParentId === nodeId) return true;
  let cursor: string | null | undefined = newParentId;
  const visto = new Set<string>();
  while (cursor) {
    if (cursor === nodeId) return true;
    if (visto.has(cursor)) break; // dato inconsistente: cortar
    visto.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  return false;
}

/** PATCH — editar un cargo (título / persona / jefe / orden / color). Solo admin. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireTenantUserApiAccess(request);
    if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
    if (!esAdmin(auth.rol)) {
      return NextResponse.json(errorResponse("Sin permiso para editar el organigrama"), { status: 403 });
    }
    const { id } = await ctx.params;
    if (!id) return NextResponse.json(errorResponse("Falta el id"), { status: 400 });

    const body = (await request.json().catch(() => ({}))) as {
      titulo?: unknown;
      nombre_persona?: unknown;
      parent_id?: unknown;
      orden?: unknown;
      color?: unknown;
    };

    const supabase = await getChatServiceClientForEmpresa(auth.empresaId);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (typeof body.titulo === "string") {
      const t = body.titulo.trim();
      if (!t) return NextResponse.json(errorResponse("El cargo no puede quedar vacío"), { status: 400 });
      patch.titulo = t;
    }
    if (body.nombre_persona !== undefined) {
      patch.nombre_persona = typeof body.nombre_persona === "string" ? body.nombre_persona.trim() || null : null;
    }
    if (body.color !== undefined) {
      patch.color = typeof body.color === "string" ? body.color.trim() || null : null;
    }
    if (body.orden != null && Number.isFinite(Number(body.orden))) patch.orden = Number(body.orden);

    // Reasignación de jefe (parent_id): validar existencia + anti-ciclo.
    if (body.parent_id !== undefined) {
      const nuevoParent = typeof body.parent_id === "string" && body.parent_id.trim() ? body.parent_id.trim() : null;
      if (nuevoParent) {
        const { data: todos, error: errAll } = await supabase
          .from("organigrama_nodos")
          .select("id, parent_id")
          .eq("empresa_id", auth.empresaId);
        if (errAll) return NextResponse.json(errorResponse(errAll.message), { status: 400 });
        const existe = (todos ?? []).some((n) => n.id === nuevoParent);
        if (!existe) return NextResponse.json(errorResponse("El jefe/superior indicado no existe"), { status: 400 });
        const parentOf = new Map<string, string | null>((todos ?? []).map((n) => [n.id, n.parent_id ?? null]));
        if (crearíaCiclo(id, nuevoParent, parentOf)) {
          return NextResponse.json(
            errorResponse("No se puede: ese cargo depende (directa o indirectamente) del que estás moviendo."),
            { status: 400 }
          );
        }
      }
      patch.parent_id = nuevoParent;
    }

    const { data, error } = await supabase
      .from("organigrama_nodos")
      .update(patch)
      .eq("id", id)
      .eq("empresa_id", auth.empresaId)
      .select(SELECT_COLS)
      .maybeSingle();

    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    if (!data) return NextResponse.json(errorResponse("Cargo no encontrado"), { status: 404 });
    return NextResponse.json(successResponse({ nodo: data }));
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo actualizar el cargo";
    return NextResponse.json(errorResponse(message), { status: 400 });
  }
}

/** DELETE — borra un cargo. Sus subordinados se re-cuelgan del jefe del cargo borrado (no se pierden). */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireTenantUserApiAccess(request);
    if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
    if (!esAdmin(auth.rol)) {
      return NextResponse.json(errorResponse("Sin permiso para editar el organigrama"), { status: 403 });
    }
    const { id } = await ctx.params;
    if (!id) return NextResponse.json(errorResponse("Falta el id"), { status: 400 });

    const supabase = await getChatServiceClientForEmpresa(auth.empresaId);

    const { data: nodo, error: errGet } = await supabase
      .from("organigrama_nodos")
      .select("id, parent_id")
      .eq("id", id)
      .eq("empresa_id", auth.empresaId)
      .maybeSingle();
    if (errGet) return NextResponse.json(errorResponse(errGet.message), { status: 400 });
    if (!nodo) return NextResponse.json(errorResponse("Cargo no encontrado"), { status: 404 });

    // Re-colgar los subordinados directos del jefe del cargo que se borra.
    const { error: errRe } = await supabase
      .from("organigrama_nodos")
      .update({ parent_id: nodo.parent_id ?? null, updated_at: new Date().toISOString() })
      .eq("empresa_id", auth.empresaId)
      .eq("parent_id", id);
    if (errRe) return NextResponse.json(errorResponse(errRe.message), { status: 400 });

    const { error: errDel } = await supabase
      .from("organigrama_nodos")
      .delete()
      .eq("id", id)
      .eq("empresa_id", auth.empresaId);
    if (errDel) return NextResponse.json(errorResponse(errDel.message), { status: 400 });

    return NextResponse.json(successResponse({ ok: true }));
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo borrar el cargo";
    return NextResponse.json(errorResponse(message), { status: 400 });
  }
}
