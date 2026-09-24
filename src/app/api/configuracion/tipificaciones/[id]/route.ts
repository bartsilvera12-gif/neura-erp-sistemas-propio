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

const NIVELES = ["familia", "estado", "subestado"] as const;
type Nivel = (typeof NIVELES)[number];
const TABLA: Record<Nivel, string> = {
  familia: "tipificacion_familias",
  estado: "tipificacion_estados",
  subestado: "tipificacion_subestados",
};

function nivelDe(v: string | null): Nivel | null {
  return NIVELES.includes(v as Nivel) ? (v as Nivel) : null;
}

/** PATCH — renombrar / activar / reordenar un nodo (solo admin). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireTenantUserApiAccess(request);
    if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
    if (!esAdmin(auth.rol)) {
      return NextResponse.json(errorResponse("Sin permiso para editar las tipificaciones"), { status: 403 });
    }

    const { id } = await params;
    const pid = id?.trim() ?? "";
    if (!pid) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

    const body = (await request.json().catch(() => ({}))) as {
      nivel?: unknown;
      nombre?: unknown;
      activo?: unknown;
      sort_order?: unknown;
    };
    const nivel = nivelDe(String(body.nivel ?? ""));
    if (!nivel) return NextResponse.json(errorResponse("Nivel inválido"), { status: 400 });

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.nombre === "string") {
      const nombre = body.nombre.trim();
      if (!nombre) return NextResponse.json(errorResponse("El nombre no puede quedar vacío"), { status: 400 });
      patch.nombre = nombre;
    }
    if (typeof body.activo === "boolean") patch.activo = body.activo;
    if (Number.isFinite(Number(body.sort_order))) patch.sort_order = Number(body.sort_order);
    // Comportamiento (superpoder) solo aplica a la familia.
    if (nivel === "familia" && "comportamiento" in body) {
      const comp = String((body as { comportamiento?: unknown }).comportamiento ?? "");
      patch.comportamiento = ["ticket_error", "ticket_cambio", "capacitacion"].includes(comp) ? comp : null;
    }

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const { data, error } = await sb
      .from(TABLA[nivel])
      .update(patch)
      .eq("empresa_id", auth.empresaId)
      .eq("id", pid)
      .select("id, nombre, sort_order, activo")
      .maybeSingle();
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    if (!data) return NextResponse.json(errorResponse("No encontrado"), { status: 404 });

    return NextResponse.json(successResponse({ item: data }));
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo actualizar";
    return NextResponse.json(errorResponse(message), { status: 400 });
  }
}

/** DELETE — elimina el nodo (y en cascada sus hijos). Solo admin. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireTenantUserApiAccess(request);
    if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
    if (!esAdmin(auth.rol)) {
      return NextResponse.json(errorResponse("Sin permiso para editar las tipificaciones"), { status: 403 });
    }

    const { id } = await params;
    const pid = id?.trim() ?? "";
    if (!pid) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

    const nivel = nivelDe(new URL(request.url).searchParams.get("nivel"));
    if (!nivel) return NextResponse.json(errorResponse("Nivel inválido"), { status: 400 });

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const { error } = await sb.from(TABLA[nivel]).delete().eq("empresa_id", auth.empresaId).eq("id", pid);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    return NextResponse.json(successResponse({ ok: true }));
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo eliminar";
    return NextResponse.json(errorResponse(message), { status: 400 });
  }
}
