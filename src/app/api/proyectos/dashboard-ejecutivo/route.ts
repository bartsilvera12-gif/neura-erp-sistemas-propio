import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { puedeVerEjecutivo, resolverPerfilDashboard } from "@/lib/proyectos/dashboard/acceso";
import { construirDashboardEjecutivo } from "@/lib/proyectos/dashboard/executive-metrics";
import { cargarDataset } from "@/lib/proyectos/dashboard/shared";
import { leerFiltros } from "@/lib/proyectos/dashboard/filtros";

/**
 * GET /api/proyectos/dashboard-ejecutivo
 *
 * Todo sale del módulo Proyectos. El dataset y los cálculos son los mismos que
 * usa el Dashboard PM (`lib/proyectos/dashboard/`): dos vistas, una sola
 * verdad. Si esto y el PM alguna vez dijeran números distintos, sería un bug,
 * no una diferencia de criterio.
 */
export async function GET(request: Request) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

  try {
    const perfil = await resolverPerfilDashboard(auth);
    if (!puedeVerEjecutivo(perfil)) {
      return NextResponse.json(errorResponse("Sin acceso al Dashboard Ejecutivo"), { status: 403 });
    }

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const filtros = leerFiltros(request, { usuarioId: perfil.usuarioId, puedeVerTodo: true });
    const ds = await cargarDataset(sb, auth.empresaId, filtros);
    return NextResponse.json(successResponse(construirDashboardEjecutivo(ds)));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "No se pudo armar el dashboard";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
