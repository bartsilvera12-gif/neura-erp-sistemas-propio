import { NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { parseUploadFile } from "@/lib/excel/import";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { requirePlanCuentasApiAccess } from "@/lib/plan-cuentas/plan-cuentas-auth";
import { parsePlanCuentaImportRows, buildPlanCuentasPreview } from "@/lib/plan-cuentas/plan-cuentas-import";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requirePlanCuentasApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  try {
    const form = await request.formData().catch(() => null);
    if (!form) return NextResponse.json(errorResponse("Form-data inválido."), { status: 400 });
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json(errorResponse("Falta el archivo."), { status: 400 });
    const actualizar = String(form.get("actualizar_existentes") ?? "") === "1";

    const parsedFile = await parseUploadFile(file);
    if ("error" in parsedFile) return NextResponse.json(errorResponse(parsedFile.error), { status: 400 });

    const supabase = await getChatServiceClientForEmpresa(auth.empresaId);
    const { data: existing, error } = await supabase
      .from("plan_cuentas")
      .select("cuenta")
      .eq("empresa_id", auth.empresaId);
    if (error) throw new Error(error.message);
    const existingCodes = new Set((existing ?? []).map((r) => (r as { cuenta: string }).cuenta));

    const parsed = parsePlanCuentaImportRows(parsedFile.rows);
    return NextResponse.json(successResponse(buildPlanCuentasPreview(parsed, existingCodes, actualizar)));
  } catch (e) {
    console.error("[plan-cuentas/import/preview]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo generar la vista previa."), { status: 500 });
  }
}
