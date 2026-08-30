import { NextResponse } from "next/server";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";
import { errorResponse, successResponse } from "@/lib/api/response";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { requireTenantUserApiAccess } from "@/lib/contabilidad/contabilidad-auth";

export const runtime = "nodejs";

/** Normaliza el nombre para el control de duplicados (mayúsculas + espacios colapsados). */
function normNombre(s: string): string {
  return String(s ?? "").toUpperCase().replace(/\s+/g, " ").trim();
}

function esAdmin(rol: string | null): boolean {
  const r = String(rol ?? "").trim();
  return r === "super_admin" || esRolAdminEmpresaOGlobal(r);
}

/** GET — lista de bancos de la empresa. Accesible a cualquier usuario (alimenta el dropdown de cobros). */
export async function GET(request: Request) {
  try {
    const auth = await requireTenantUserApiAccess(request);
    if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

    const supabase = await getChatServiceClientForEmpresa(auth.empresaId);
    const { data, error } = await supabase
      .from("bancos")
      .select("id, nombre, activo, sort_order")
      .eq("empresa_id", auth.empresaId)
      .order("sort_order", { ascending: true })
      .order("nombre", { ascending: true });
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    return NextResponse.json(
      successResponse({ bancos: data ?? [], meta: { can_edit: esAdmin(auth.rol) } })
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudieron cargar los bancos";
    return NextResponse.json(errorResponse(message), { status: 500 });
  }
}

/** POST — alta de un banco (solo admin). */
export async function POST(request: Request) {
  try {
    const auth = await requireTenantUserApiAccess(request);
    if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
    if (!esAdmin(auth.rol)) {
      return NextResponse.json(errorResponse("Sin permiso para editar el catálogo de bancos"), { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as { nombre?: unknown; sort_order?: unknown };
    const nombre = typeof body.nombre === "string" ? body.nombre.trim() : "";
    if (!nombre) return NextResponse.json(errorResponse("Indicá el nombre del banco"), { status: 400 });

    const supabase = await getChatServiceClientForEmpresa(auth.empresaId);
    const { data, error } = await supabase
      .from("bancos")
      .insert({
        empresa_id: auth.empresaId,
        nombre,
        nombre_norm: normNombre(nombre),
        sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0,
      })
      .select("id, nombre, activo, sort_order")
      .single();

    if (error) {
      const status = error.code === "23505" ? 409 : 400;
      const msg = error.code === "23505" ? "Ya existe un banco con ese nombre" : error.message;
      return NextResponse.json(errorResponse(msg), { status });
    }
    return NextResponse.json(successResponse({ banco: data }), { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo crear el banco";
    return NextResponse.json(errorResponse(message), { status: 400 });
  }
}
