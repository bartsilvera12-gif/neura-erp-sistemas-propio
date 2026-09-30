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

/** GET — todos los nodos del organigrama de la empresa (lista plana; el front arma el árbol). */
export async function GET(request: Request) {
  try {
    const auth = await requireTenantUserApiAccess(request);
    if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

    const supabase = await getChatServiceClientForEmpresa(auth.empresaId);
    const { data, error } = await supabase
      .from("organigrama_nodos")
      .select(SELECT_COLS)
      .eq("empresa_id", auth.empresaId)
      .order("orden", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      // Drift-safe: si el schema del tenant todavía no tiene la tabla, devolvemos vacío
      // (el módulo no rompe para empresas donde aún no se creó).
      if (error.code === "42P01") {
        return NextResponse.json(successResponse({ nodos: [], meta: { can_edit: esAdmin(auth.rol) } }));
      }
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }

    return NextResponse.json(successResponse({ nodos: data ?? [], meta: { can_edit: esAdmin(auth.rol) } }));
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo cargar el organigrama";
    return NextResponse.json(errorResponse(message), { status: 500 });
  }
}

/** POST — alta de un cargo (solo admin). */
export async function POST(request: Request) {
  try {
    const auth = await requireTenantUserApiAccess(request);
    if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
    if (!esAdmin(auth.rol)) {
      return NextResponse.json(errorResponse("Sin permiso para editar el organigrama"), { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      titulo?: unknown;
      parent_id?: unknown;
      nombre_persona?: unknown;
      orden?: unknown;
      color?: unknown;
    };
    const titulo = typeof body.titulo === "string" ? body.titulo.trim() : "";
    if (!titulo) return NextResponse.json(errorResponse("Indicá el cargo (título)"), { status: 400 });

    const parentId = typeof body.parent_id === "string" && body.parent_id.trim() ? body.parent_id.trim() : null;
    const nombrePersona = typeof body.nombre_persona === "string" ? body.nombre_persona.trim() || null : null;
    const color = typeof body.color === "string" ? body.color.trim() || null : null;
    const orden = Number.isFinite(Number(body.orden)) ? Number(body.orden) : 0;

    const supabase = await getChatServiceClientForEmpresa(auth.empresaId);

    // Si viene parent, validar que exista y sea de la misma empresa.
    if (parentId) {
      const { data: padre } = await supabase
        .from("organigrama_nodos")
        .select("id")
        .eq("id", parentId)
        .eq("empresa_id", auth.empresaId)
        .maybeSingle();
      if (!padre) return NextResponse.json(errorResponse("El jefe/superior indicado no existe"), { status: 400 });
    }

    const { data, error } = await supabase
      .from("organigrama_nodos")
      .insert({
        empresa_id: auth.empresaId,
        parent_id: parentId,
        titulo,
        nombre_persona: nombrePersona,
        color,
        orden,
      })
      .select(SELECT_COLS)
      .single();

    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    return NextResponse.json(successResponse({ nodo: data }), { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo crear el cargo";
    return NextResponse.json(errorResponse(message), { status: 400 });
  }
}
