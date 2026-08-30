import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";

/**
 * GET /api/project-managers — Project managers de la empresa y su cartera.
 *
 * Un PM es un usuario con `es_project_manager = true`. La cartera sale de
 * `clientes.project_manager_id`: un PM por cliente, igual que el vendedor.
 *
 * Los usuarios viven en el CATÁLOGO (`createServiceRoleClient`) y los clientes
 * en el schema del tenant (`getChatServiceClientForEmpresa`): son dos clientes
 * distintos a propósito, no es duplicación.
 */

export type ProjectManagerRow = {
  id: string;
  nombre: string;
  email: string | null;
  area: string | null;
  clientes: number;
};

export async function GET(request: Request) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  try {
    const catalog = createServiceRoleClient();
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    const { data: pmData, error: pmError } = await catalog
      .from("usuarios")
      .select("id, nombre, email, area, estado")
      .eq("empresa_id", auth.empresaId)
      .eq("es_project_manager", true)
      .order("nombre");
    if (pmError) return NextResponse.json(errorResponse(pmError.message), { status: 400 });

    const pms = (pmData ?? []) as {
      id: string;
      nombre: string | null;
      email: string | null;
      area: string | null;
      estado: string | null;
    }[];

    // Una sola query para toda la cartera: se cuenta en memoria en vez de pedir
    // un count por PM (serían N round-trips para un dato que entra en una fila).
    const { data: cliData, error: cliError } = await sb
      .from("clientes")
      .select("id, project_manager_id")
      .eq("empresa_id", auth.empresaId)
      .is("deleted_at", null);
    if (cliError) return NextResponse.json(errorResponse(cliError.message), { status: 400 });

    const clientes = (cliData ?? []) as { id: string; project_manager_id: string | null }[];
    const porPm = new Map<string, number>();
    for (const c of clientes) {
      const k = c.project_manager_id;
      if (!k) continue;
      porPm.set(k, (porPm.get(k) ?? 0) + 1);
    }

    const project_managers: ProjectManagerRow[] = pms.map((u) => ({
      id: u.id,
      nombre: (u.nombre ?? "").trim() || "(sin nombre)",
      email: u.email,
      area: u.area,
      clientes: porPm.get(u.id) ?? 0,
    }));

    // Asignaciones que apuntan a alguien que ya no es PM (le sacaron la marca):
    // no se pierden, pero hay que poder verlas para reasignarlas.
    const idsPm = new Set(pms.map((u) => u.id));
    const huerfanos = [...porPm.entries()].filter(([id]) => !idsPm.has(id));

    return NextResponse.json(
      successResponse({
        project_managers,
        total_clientes: clientes.length,
        sin_asignar: clientes.filter((c) => !c.project_manager_id).length,
        asignados_a_no_pm: huerfanos.reduce((a, [, n]) => a + n, 0),
      })
    );
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error"), { status: 500 });
  }
}
