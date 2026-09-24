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
type EstadoRow = FamiliaRow & { familia_id: string; comportamiento?: string | null };

/** Acciones que puede disparar un SUB-ESTADO (superpoderes configurables). */
const COMPORTAMIENTOS = ["", "ticket_error", "ticket_cambio", "capacitacion"] as const;

// Modelo de 2 niveles: "familia" = ESTADO (Solicitud/Reclamo/Consulta) ·
// "estado" = SUB-ESTADO (la cosa puntual, lleva el comportamiento/acción).
// La tabla tipificacion_subestados (3er nivel) quedó sin uso.
const NIVELES = ["familia", "estado"] as const;
type Nivel = (typeof NIVELES)[number];
const TABLA: Record<Nivel, string> = {
  familia: "tipificacion_familias",
  estado: "tipificacion_estados",
};

/** GET — árbol de 2 niveles: Estado → Sub-estados (con su acción). */
export async function GET(request: Request) {
  try {
    const auth = await requireTenantUserApiAccess(request);
    if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const [famRes, estRes] = await Promise.all([
      sb.from("tipificacion_familias").select("id, nombre, sort_order, activo").eq("empresa_id", auth.empresaId).order("sort_order").order("nombre"),
      sb.from("tipificacion_estados").select("id, familia_id, nombre, sort_order, activo, comportamiento").eq("empresa_id", auth.empresaId).order("sort_order").order("nombre"),
    ]);
    const err = famRes.error || estRes.error;
    if (err) return NextResponse.json(errorResponse(err.message), { status: 400 });

    const estados = (estRes.data ?? []) as EstadoRow[];
    const familias = (famRes.data ?? []) as FamiliaRow[];

    // En la respuesta, cada Estado (familia) trae sus Sub-estados (estados).
    const arbol = familias.map((f) => ({
      ...f,
      subestados: estados.filter((e) => e.familia_id === f.id),
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
    if (nivel === "estado") {
      registro.familia_id = parentId;
      // El comportamiento (superpoder) vive en el SUB-ESTADO (nivel "estado"): es
      // lo más granular y es lo que dispara la acción (ticket / agenda) al tipificar.
      const comp = String((body as { comportamiento?: unknown }).comportamiento ?? "");
      registro.comportamiento = COMPORTAMIENTOS.includes(comp as (typeof COMPORTAMIENTOS)[number]) && comp ? comp : null;
    }

    const sel = nivel === "estado" ? "id, nombre, sort_order, activo, comportamiento" : "id, nombre, sort_order, activo";
    const { data, error } = await sb.from(TABLA[nivel]).insert(registro).select(sel).single();
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    return NextResponse.json(successResponse({ item: data }), { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo crear";
    return NextResponse.json(errorResponse(message), { status: 400 });
  }
}
