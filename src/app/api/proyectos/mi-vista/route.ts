import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { isErpRolAdministrador, isErpRolSupervisor } from "@/lib/usuarios/erp-rol-normalize";

/**
 * Resuelve el ALCANCE por defecto del tablero de Proyectos para el usuario actual:
 *  - "todos"  → gerencia (admin/supervisor/PM) O quien NO es responsable de ningún proyecto
 *               (su vista "Mías" estaría vacía, así que arrancar ahí no sirve — no encontraría
 *               nada al buscar). Caso típico: MKT/operaciones que necesitan mirar, no ejecutar.
 *  - "mios"   → el resto (técnicos/comerciales/QA con proyectos propios).
 *
 * Reemplaza el uso de /api/usuarios/me para esta decisión: acá se calcula todo del lado del
 * servidor (rol + es_project_manager + si es responsable de algún proyecto).
 */
export async function GET(request: Request) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const yo = auth.usuarioCatalogId;

    const { data: urow } = await sb
      .from("usuarios")
      .select("es_project_manager")
      .eq("id", yo)
      .maybeSingle();
    const esPm = (urow as { es_project_manager?: boolean | null } | null)?.es_project_manager === true;
    const esGerencia = isErpRolAdministrador(auth.rol) || isErpRolSupervisor(auth.rol) || esPm;

    const contarPor = (campo: "responsable_tecnico_id" | "responsable_comercial_id" | "qa_responsable_id") =>
      sb
        .from("proyectos")
        .select("id", { count: "exact", head: true })
        .eq("empresa_id", auth.empresaId)
        .eq("archivado", false)
        .eq(campo, yo);

    const [cTec, cCom, cQa] = await Promise.all([
      contarPor("responsable_tecnico_id"),
      contarPor("responsable_comercial_id"),
      contarPor("qa_responsable_id"),
    ]);
    const esResponsable =
      (cTec.count ?? 0) > 0 || (cCom.count ?? 0) > 0 || (cQa.count ?? 0) > 0;

    const alcance_default: "todos" | "mios" = esGerencia || !esResponsable ? "todos" : "mios";

    return NextResponse.json(
      successResponse({ alcance_default, es_gerencia: esGerencia, es_responsable: esResponsable })
    );
  } catch (e) {
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "Error al resolver alcance"),
      { status: 500 }
    );
  }
}
