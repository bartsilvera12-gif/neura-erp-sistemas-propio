import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";

/**
 * GET   /api/project-managers/[id] — cartera del PM + clientes disponibles.
 * PATCH /api/project-managers/[id] — asigna o quita clientes de esa cartera.
 *
 * Quién puede ESCRIBIR: admin de empresa, super admin, o el propio PM sobre su
 * cartera. Un usuario cualquiera con acceso a Proyectos puede mirar, no tocar:
 * mover un cliente de cartera cambia de quién es la responsabilidad.
 */

type ClienteRow = {
  id: string;
  empresa: string | null;
  nombre_contacto: string | null;
  telefono: string | null;
  email: string | null;
  estado: string | null;
  project_manager_id: string | null;
};

/** Etiqueta visible del cliente: razón social si hay, si no el contacto. */
function labelCliente(c: ClienteRow): string {
  return (c.empresa ?? "").trim() || (c.nombre_contacto ?? "").trim() || "(sin nombre)";
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }
  const { id } = await ctx.params;

  try {
    const catalog = createServiceRoleClient();
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    const { data: pm, error: pmError } = await catalog
      .from("usuarios")
      .select("id, nombre, email, area, estado, es_project_manager")
      .eq("empresa_id", auth.empresaId)
      .eq("id", id)
      .maybeSingle();
    if (pmError) return NextResponse.json(errorResponse(pmError.message), { status: 400 });
    if (!pm) return NextResponse.json(errorResponse("Project manager no encontrado"), { status: 404 });

    const { data, error } = await sb
      .from("clientes")
      .select("id, empresa, nombre_contacto, telefono, email, estado, project_manager_id")
      .eq("empresa_id", auth.empresaId)
      .is("deleted_at", null)
      .order("empresa");
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    const todos = (data ?? []) as ClienteRow[];
    const mapear = (c: ClienteRow) => ({
      id: c.id,
      label: labelCliente(c),
      contacto: (c.nombre_contacto ?? "").trim(),
      telefono: (c.telefono ?? "").trim(),
      email: (c.email ?? "").trim(),
      estado: c.estado,
      /** Ya lo lleva otro PM: se puede mover, pero conviene avisarlo. */
      ocupado_por: c.project_manager_id && c.project_manager_id !== id ? c.project_manager_id : null,
    });

    const asignados = todos.filter((c) => c.project_manager_id === id).map(mapear);
    const disponibles = todos.filter((c) => c.project_manager_id !== id).map(mapear);

    // Nombre del PM que ocupa cada cliente, para poder decir "hoy lo lleva X"
    // en vez de mostrar un uuid.
    const otros = [...new Set(disponibles.map((c) => c.ocupado_por).filter(Boolean) as string[])];
    const nombrePm = new Map<string, string>();
    if (otros.length) {
      const { data: us } = await catalog
        .from("usuarios")
        .select("id, nombre")
        .eq("empresa_id", auth.empresaId)
        .in("id", otros);
      for (const u of (us ?? []) as { id: string; nombre: string | null }[]) {
        nombrePm.set(u.id, (u.nombre ?? "").trim());
      }
    }

    return NextResponse.json(
      successResponse({
        project_manager: {
          id: pm.id as string,
          nombre: ((pm.nombre as string | null) ?? "").trim() || "(sin nombre)",
          email: (pm.email as string | null) ?? null,
          area: (pm.area as string | null) ?? null,
          es_project_manager: pm.es_project_manager === true,
        },
        asignados,
        disponibles: disponibles.map((c) => ({
          ...c,
          ocupado_por_nombre: c.ocupado_por ? nombrePm.get(c.ocupado_por) ?? null : null,
        })),
        puede_editar: puedeEditarCartera(auth.rol, auth.bootstrapSuperAdmin, auth.usuarioCatalogId, id),
      })
    );
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error"), { status: 500 });
  }
}

function puedeEditarCartera(
  rol: string | null,
  bootstrapSuperAdmin: boolean,
  usuarioId: string,
  pmId: string
): boolean {
  return bootstrapSuperAdmin || esRolAdminEmpresaOGlobal(rol) || usuarioId === pmId;
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }
  const { id } = await ctx.params;

  if (!puedeEditarCartera(auth.rol, auth.bootstrapSuperAdmin, auth.usuarioCatalogId, id)) {
    return NextResponse.json(
      errorResponse("Solo un administrador o el propio project manager puede cambiar esta cartera"),
      { status: 403 }
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      asignar?: unknown;
      quitar?: unknown;
    };
    const asignar = Array.isArray(body.asignar) ? body.asignar.map(String).filter(Boolean) : [];
    const quitar = Array.isArray(body.quitar) ? body.quitar.map(String).filter(Boolean) : [];
    if (!asignar.length && !quitar.length) {
      return NextResponse.json(errorResponse("Nada para cambiar"), { status: 400 });
    }

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    if (asignar.length) {
      const { error } = await sb
        .from("clientes")
        .update({ project_manager_id: id })
        .eq("empresa_id", auth.empresaId)
        .in("id", asignar);
      if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    if (quitar.length) {
      // `eq(project_manager_id, id)` a propósito: si mientras tanto el cliente
      // pasó a otra cartera, quitarlo acá no debe borrar la asignación ajena.
      const { error } = await sb
        .from("clientes")
        .update({ project_manager_id: null })
        .eq("empresa_id", auth.empresaId)
        .eq("project_manager_id", id)
        .in("id", quitar);
      if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    }

    return NextResponse.json(successResponse({ asignados: asignar.length, quitados: quitar.length }));
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error"), { status: 500 });
  }
}
