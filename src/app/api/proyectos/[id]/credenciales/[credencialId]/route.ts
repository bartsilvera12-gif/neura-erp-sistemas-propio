import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { textoOpcional, type ProyectoCredencialBody } from "@/lib/proyectos/credenciales-shared";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; credencialId: string }> }
) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  const { id, credencialId } = await params;
  const pid = id?.trim() ?? "";
  const cid = credencialId?.trim() ?? "";
  if (!pid || !cid) {
    return NextResponse.json(errorResponse("ids obligatorios"), { status: 400 });
  }

  try {
    const body = (await request.json().catch(() => null)) as ProyectoCredencialBody | null;
    if (!body) return NextResponse.json(errorResponse("body obligatorio"), { status: 400 });

    const patch: Record<string, unknown> = { updated_by: auth.usuarioCatalogId };

    if (body.nombre !== undefined) {
      const nombre = typeof body.nombre === "string" ? body.nombre.trim() : "";
      if (!nombre) return NextResponse.json(errorResponse("nombre obligatorio"), { status: 400 });
      patch.nombre = nombre;
    }
    if (body.url !== undefined) patch.url = textoOpcional(body.url);
    if (body.usuario !== undefined) patch.usuario = textoOpcional(body.usuario);
    // La contraseña no se trimea: los espacios pueden ser parte del secreto.
    if (body.password !== undefined) {
      patch.password = typeof body.password === "string" && body.password ? body.password : null;
    }
    if (body.notas !== undefined) patch.notas = textoOpcional(body.notas);

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    const { data, error } = await sb
      .from("proyecto_credenciales")
      .update(patch)
      .eq("empresa_id", auth.empresaId)
      .eq("proyecto_id", pid)
      .eq("id", cid)
      .select("*");

    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return NextResponse.json(errorResponse("No encontrado"), { status: 404 });

    await sb
      .from("proyectos")
      .update({ last_activity_at: new Date().toISOString(), updated_by: auth.usuarioCatalogId })
      .eq("empresa_id", auth.empresaId)
      .eq("id", pid);

    return NextResponse.json(successResponse(row));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; credencialId: string }> }
) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  const { id, credencialId } = await params;
  const pid = id?.trim() ?? "";
  const cid = credencialId?.trim() ?? "";
  if (!pid || !cid) {
    return NextResponse.json(errorResponse("ids obligatorios"), { status: 400 });
  }

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    const { error } = await sb
      .from("proyecto_credenciales")
      .delete()
      .eq("empresa_id", auth.empresaId)
      .eq("proyecto_id", pid)
      .eq("id", cid);

    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    await sb
      .from("proyectos")
      .update({ last_activity_at: new Date().toISOString(), updated_by: auth.usuarioCatalogId })
      .eq("empresa_id", auth.empresaId)
      .eq("id", pid);

    return NextResponse.json(successResponse({ id: cid }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
