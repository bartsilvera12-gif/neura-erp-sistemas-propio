import { NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api/response";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { requirePlanCuentasApiAccess } from "@/lib/plan-cuentas/plan-cuentas-auth";
import {
  listPlanCuentas,
  parsePlanCuentaCreate,
  summarize,
  validateParent,
  PlanCuentaValidationError,
} from "@/lib/plan-cuentas/plan-cuentas";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const auth = await requirePlanCuentasApiAccess(request);
    if (!auth.ok) {
      return NextResponse.json(errorResponse(auth.message), { status: auth.status });
    }
    const supabase = await getChatServiceClientForEmpresa(auth.empresaId);
    const cuentas = await listPlanCuentas(supabase, auth.empresaId);
    return NextResponse.json(
      successResponse({
        cuentas,
        summary: summarize(cuentas),
        meta: { can_edit: auth.canEdit, source_table: "plan_cuentas" },
      })
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo cargar el Plan de Cuentas";
    return NextResponse.json(errorResponse(message), { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requirePlanCuentasApiAccess(request);
    if (!auth.ok) {
      return NextResponse.json(errorResponse(auth.message), { status: auth.status });
    }
    const body = await request.json().catch(() => ({}));
    const create = parsePlanCuentaCreate(body);

    const supabase = await getChatServiceClientForEmpresa(auth.empresaId);
    const rows = await listPlanCuentas(supabase, auth.empresaId);

    if (rows.some((r) => r.cuenta === create.cuenta)) {
      return NextResponse.json(errorResponse(`Ya existe una cuenta con el código "${create.cuenta}".`), { status: 409 });
    }
    validateParent(rows, null, create.cuenta_padre_id, create.nivel);

    const { data, error } = await supabase
      .from("plan_cuentas")
      .insert({
        empresa_id: auth.empresaId,
        cuenta: create.cuenta,
        denominacion: create.denominacion,
        nivel: create.nivel,
        naturaleza: create.naturaleza,
        asentable: create.asentable,
        centro_costo: create.centro_costo,
        moneda: create.moneda,
        tipo_cambio: create.tipo_cambio,
        cuenta_sset: create.cuenta_sset,
        cuenta_padre_id: create.cuenta_padre_id,
        activo: create.activo,
      })
      .select("*")
      .single();

    if (error) {
      const status = error.code === "23505" ? 409 : 400;
      return NextResponse.json(errorResponse(error.message), { status });
    }
    return NextResponse.json(successResponse({ cuenta: data }), { status: 201 });
  } catch (e) {
    if (e instanceof PlanCuentaValidationError) {
      return NextResponse.json(errorResponse(e.message), { status: e.status });
    }
    const message = e instanceof Error ? e.message : "No se pudo crear la cuenta";
    return NextResponse.json(errorResponse(message), { status: 400 });
  }
}
