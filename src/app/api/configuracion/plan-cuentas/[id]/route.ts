import { NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api/response";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { requirePlanCuentasApiAccess } from "@/lib/plan-cuentas/plan-cuentas-auth";
import {
  listPlanCuentas,
  parsePlanCuentaUpdate,
  validateParent,
  PlanCuentaValidationError,
} from "@/lib/plan-cuentas/plan-cuentas";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await requirePlanCuentasApiAccess(request);
    if (!auth.ok) {
      return NextResponse.json(errorResponse(auth.message), { status: auth.status });
    }
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const patch = parsePlanCuentaUpdate(body);
    if (Object.keys(patch).length === 0) {
      return NextResponse.json(errorResponse("No hay cambios para aplicar."), { status: 400 });
    }

    const supabase = await getChatServiceClientForEmpresa(auth.empresaId);
    const rows = await listPlanCuentas(supabase, auth.empresaId);
    const current = rows.find((r) => r.id === id);
    if (!current) {
      return NextResponse.json(errorResponse("Cuenta no encontrada"), { status: 404 });
    }

    // Código único (si cambia).
    if (patch.cuenta && patch.cuenta !== current.cuenta) {
      if (rows.some((r) => r.id !== id && r.cuenta === patch.cuenta)) {
        return NextResponse.json(errorResponse(`Ya existe una cuenta con el código "${patch.cuenta}".`), { status: 409 });
      }
    }

    // Jerarquía: validar el par (padre, nivel) resultante.
    const nextNivel = patch.nivel ?? current.nivel;
    const nextParent = patch.cuenta_padre_id !== undefined ? patch.cuenta_padre_id : current.cuenta_padre_id;
    validateParent(rows, id, nextParent ?? null, nextNivel);

    // Si tiene hijos, un cambio de nivel no debe romper la relación padre<hijo con sus hijos.
    if (current.tiene_hijos && patch.nivel !== undefined && patch.nivel !== current.nivel) {
      const hijos = rows.filter((r) => r.cuenta_padre_id === id);
      const minHijo = Math.min(...hijos.map((h) => h.nivel));
      if (nextNivel >= minHijo) {
        return NextResponse.json(
          errorResponse(
            `El nuevo nivel (${nextNivel}) debe ser menor que el de sus cuentas hijas (mín. ${minHijo}).`
          ),
          { status: 400 }
        );
      }
    }

    const { data, error } = await supabase
      .from("plan_cuentas")
      .update(patch)
      .eq("id", id)
      .eq("empresa_id", auth.empresaId)
      .select("*")
      .single();

    if (error) {
      const status = error.code === "23505" ? 409 : 400;
      return NextResponse.json(errorResponse(error.message), { status });
    }
    return NextResponse.json(successResponse({ cuenta: data }));
  } catch (e) {
    if (e instanceof PlanCuentaValidationError) {
      return NextResponse.json(errorResponse(e.message), { status: e.status });
    }
    const message = e instanceof Error ? e.message : "No se pudo actualizar la cuenta";
    return NextResponse.json(errorResponse(message), { status: 400 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const auth = await requirePlanCuentasApiAccess(request);
    if (!auth.ok) {
      return NextResponse.json(errorResponse(auth.message), { status: auth.status });
    }
    const { id } = await context.params;
    const supabase = await getChatServiceClientForEmpresa(auth.empresaId);
    const rows = await listPlanCuentas(supabase, auth.empresaId);
    const current = rows.find((r) => r.id === id);
    if (!current) {
      return NextResponse.json(errorResponse("Cuenta no encontrada"), { status: 404 });
    }
    if (current.tiene_hijos) {
      return NextResponse.json(
        errorResponse("No se puede eliminar: la cuenta tiene cuentas hijas. Reasigná o eliminá las hijas primero, o desactivala."),
        { status: 409 }
      );
    }
    // Preparado para futuras tablas de asientos/movimientos contables: cuando existan,
    // aquí se validará que la cuenta no tenga movimientos asociados antes de borrar.

    const { error } = await supabase
      .from("plan_cuentas")
      .delete()
      .eq("id", id)
      .eq("empresa_id", auth.empresaId);
    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    return NextResponse.json(successResponse({ deleted: true, id }));
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo eliminar la cuenta";
    return NextResponse.json(errorResponse(message), { status: 400 });
  }
}
