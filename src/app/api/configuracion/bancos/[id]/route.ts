import { NextResponse } from "next/server";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";
import { errorResponse, successResponse } from "@/lib/api/response";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { requireTenantUserApiAccess } from "@/lib/contabilidad/contabilidad-auth";

export const runtime = "nodejs";

function normNombre(s: string): string {
  return String(s ?? "").toUpperCase().replace(/\s+/g, " ").trim();
}
function esAdmin(rol: string | null): boolean {
  const r = String(rol ?? "").trim();
  return r === "super_admin" || esRolAdminEmpresaOGlobal(r);
}

/** PUT — edición de un banco (nombre / activo / orden). Solo admin. */
export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireTenantUserApiAccess(request);
    if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
    if (!esAdmin(auth.rol)) {
      return NextResponse.json(errorResponse("Sin permiso para editar el catálogo de bancos"), { status: 403 });
    }
    const { id } = await ctx.params;
    if (!id) return NextResponse.json(errorResponse("Falta el id"), { status: 400 });

    const body = (await request.json().catch(() => ({}))) as {
      nombre?: unknown;
      activo?: unknown;
      sort_order?: unknown;
    };
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.nombre === "string") {
      const nombre = body.nombre.trim();
      if (!nombre) return NextResponse.json(errorResponse("El nombre no puede quedar vacío"), { status: 400 });
      patch.nombre = nombre;
      patch.nombre_norm = normNombre(nombre);
    }
    if (typeof body.activo === "boolean") patch.activo = body.activo;
    if (body.sort_order != null && Number.isFinite(Number(body.sort_order))) patch.sort_order = Number(body.sort_order);

    const supabase = await getChatServiceClientForEmpresa(auth.empresaId);
    const { data, error } = await supabase
      .from("bancos")
      .update(patch)
      .eq("id", id)
      .eq("empresa_id", auth.empresaId)
      .select("id, nombre, activo, sort_order")
      .single();

    if (error) {
      const status = error.code === "23505" ? 409 : 400;
      const msg = error.code === "23505" ? "Ya existe un banco con ese nombre" : error.message;
      return NextResponse.json(errorResponse(msg), { status });
    }
    return NextResponse.json(successResponse({ banco: data }));
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo actualizar el banco";
    return NextResponse.json(errorResponse(message), { status: 400 });
  }
}
