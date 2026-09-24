import { NextResponse } from "next/server";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";
import { errorResponse, successResponse } from "@/lib/api/response";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { requireTenantUserApiAccess } from "@/lib/contabilidad/contabilidad-auth";

export const runtime = "nodejs";

function esAdmin(rol: string | null): boolean {
  const r = String(rol ?? "").trim();
  return r === "super_admin" || esRolAdminEmpresaOGlobal(r);
}

type FamiliaRow = { id: string; nombre: string; sort_order: number; activo: boolean };
type EstadoRow = FamiliaRow & { familia_id: string };
type SubestadoRow = FamiliaRow & { estado_id: string };

const NIVELES = ["familia", "estado", "subestado"] as const;
type Nivel = (typeof NIVELES)[number];
const TABLA: Record<Nivel, string> = {
  familia: "tipificacion_familias",
  estado: "tipificacion_estados",
  subestado: "tipificacion_subestados",
};

/** GET — árbol completo: familias → estados → sub-estados. */
export async function GET(request: Request) {
  try {
    const auth = await requireTenantUserApiAccess(request);
    if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const [famRes, estRes, subRes] = await Promise.all([
      sb.from("tipificacion_familias").select("id, nombre, sort_order, activo").eq("empresa_id", auth.empresaId).order("sort_order").order("nombre"),
      sb.from("tipificacion_estados").select("id, familia_id, nombre, sort_order, activo").eq("empresa_id", auth.empresaId).order("sort_order").order("nombre"),
      sb.from("tipificacion_subestados").select("id, estado_id, nombre, sort_order, activo").eq("empresa_id", auth.empresaId).order("sort_order").order("nombre"),
    ]);
    const err = famRes.error || estRes.error || subRes.error;
    if (err) return NextResponse.json(errorResponse(err.message), { status: 400 });

    const subs = (subRes.data ?? []) as SubestadoRow[];
    const estados = (estRes.data ?? []) as EstadoRow[];
    const familias = (famRes.data ?? []) as FamiliaRow[];

    const arbol = familias.map((f) => ({
      ...f,
      estados: estados
        .filter((e) => e.familia_id === f.id)
        .map((e) => ({
          ...e,
          subestados: subs.filter((s) => s.estado_id === e.id),
        })),
    }));

    return NextResponse.json(successResponse({ familias: arbol, meta: { can_edit: esAdmin(auth.rol) } }));
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudieron cargar las tipificaciones";
    return NextResponse.json(errorResponse(message), { status: 500 });
  }
}

/** POST — alta de familia / estado / sub-estado (solo admin). */
export async function POST(request: Request) {
  try {
    const auth = await requireTenantUserApiAccess(request);
    if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
    if (!esAdmin(auth.rol)) {
      return NextResponse.json(errorResponse("Sin permiso para editar las tipificaciones"), { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      nivel?: unknown;
      nombre?: unknown;
      parent_id?: unknown;
    };
    const nivel = String(body.nivel ?? "") as Nivel;
    if (!NIVELES.includes(nivel)) {
      return NextResponse.json(errorResponse("Nivel inválido"), { status: 400 });
    }
    const nombre = typeof body.nombre === "string" ? body.nombre.trim() : "";
    if (!nombre) return NextResponse.json(errorResponse("Indicá el nombre"), { status: 400 });
    const parentId = typeof body.parent_id === "string" && body.parent_id ? body.parent_id : null;
    if (nivel !== "familia" && !parentId) {
      return NextResponse.json(errorResponse("Falta el nodo padre"), { status: 400 });
    }

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const registro: Record<string, unknown> = {
      empresa_id: auth.empresaId,
      nombre,
      sort_order: Number.isFinite(Number((body as { sort_order?: unknown }).sort_order))
        ? Number((body as { sort_order?: unknown }).sort_order)
        : 0,
    };
    if (nivel === "estado") registro.familia_id = parentId;
    if (nivel === "subestado") registro.estado_id = parentId;

    const { data, error } = await sb
      .from(TABLA[nivel])
      .insert(registro)
      .select("id, nombre, sort_order, activo")
      .single();
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    return NextResponse.json(successResponse({ item: data }), { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo crear";
    return NextResponse.json(errorResponse(message), { status: 400 });
  }
}
