import { NextResponse } from "next/server";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";
import { getProduccionReport } from "@/lib/produccion/programacion-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/produccion/programacion?period=YYYY-MM
 * Reporte gerencial de producción / programación (read-only) para la empresa autenticada.
 *
 * Auth: `requireProyectosApiAccess` (usuario + empresa + módulo Proyectos, contempla super_admin
 * y bootstrap) y, ADEMÁS, gate de rol: este reporte es gerencial (área técnica + gerencia), no
 * para cualquiera con el módulo. Se permite: super admin (rol o bootstrap) y roles admin de
 * empresa (`esRolAdminEmpresaOGlobal`). Cualquier otro rol → 403.
 */
export async function GET(request: Request) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  if (!(auth.bootstrapSuperAdmin || esRolAdminEmpresaOGlobal(auth.rol))) {
    return NextResponse.json(
      { error: "Este reporte está restringido a gerencia y administración." },
      { status: 403 }
    );
  }

  const url = new URL(request.url);
  const rawPeriod = url.searchParams.get("period");
  const period = rawPeriod && /^\d{4}-\d{2}$/.test(rawPeriod) ? rawPeriod : undefined;

  try {
    const report = await getProduccionReport(auth.empresaId, period);
    return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[api/produccion/programacion]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Error generando reporte" }, { status: 500 });
  }
}
