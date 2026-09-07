import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { puedeVerPm, resolverPerfilDashboard } from "@/lib/proyectos/dashboard/acceso";
import { construirDashboardPm } from "@/lib/proyectos/dashboard/pm-metrics";
import { cargarDataset } from "@/lib/proyectos/dashboard/shared";
import { leerFiltros } from "@/lib/proyectos/dashboard/filtros";

/**
 * GET /api/proyectos/dashboard-pm
 *
 * "Mis proyectos" = la cartera del PM, derivada de `clientes.project_manager_id`
 * (la relación que el sistema ya mantiene). No se inventa una tabla
 * proyecto↔PM: el PM es del cliente, y el proyecto hereda el del suyo.
 */
export async function GET(request: Request) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

  try {
    const perfil = await resolverPerfilDashboard(auth);
    if (!puedeVerPm(perfil)) {
      return NextResponse.json(errorResponse("Sin acceso al Dashboard PM"), { status: 403 });
    }

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    // Un PM que no es admin ve su cartera y nada más, pida lo que pida.
    const filtros = leerFiltros(request, {
      usuarioId: perfil.usuarioId,
      puedeVerTodo: perfil.esAdmin,
    });
    const ds = await cargarDataset(sb, auth.empresaId, filtros);
    return NextResponse.json(
      successResponse({ ...construirDashboardPm(ds), puede_ver_todo: perfil.esAdmin })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "No se pudo armar el dashboard";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
