import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { textoOpcional, type ProyectoCredencialBody } from "@/lib/proyectos/credenciales-shared";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  const { id } = await params;
  const pid = id?.trim() ?? "";
  if (!pid) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const { data, error } = await sb
      .from("proyecto_credenciales")
      .select("*")
      .eq("empresa_id", auth.empresaId)
      .eq("proyecto_id", pid)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    return NextResponse.json(successResponse(data ?? []));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  const { id } = await params;
  const pid = id?.trim() ?? "";
  if (!pid) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

  try {
    const body = (await request.json().catch(() => null)) as ProyectoCredencialBody | null;
    const nombre = typeof body?.nombre === "string" ? body.nombre.trim() : "";
    if (!nombre) return NextResponse.json(errorResponse("nombre obligatorio"), { status: 400 });

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    // El orden lo define la API (MAX+1) para que el alta quede siempre al final.
    const { data: ultimo } = await sb
      .from("proyecto_credenciales")
      .select("sort_order")
      .eq("empresa_id", auth.empresaId)
      .eq("proyecto_id", pid)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    const siguiente = ((ultimo as { sort_order?: number } | null)?.sort_order ?? -1) + 1;

    const insert = {
      empresa_id: auth.empresaId,
      proyecto_id: pid,
      nombre,
      url: textoOpcional(body?.url),
      usuario: textoOpcional(body?.usuario),
      password: typeof body?.password === "string" && body.password ? body.password : null,
      notas: textoOpcional(body?.notas),
      sort_order: siguiente,
      created_by: auth.usuarioCatalogId,
      updated_by: auth.usuarioCatalogId,
    };

    const { data, error } = await sb.from("proyecto_credenciales").insert(insert).select("*");
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    await sb
      .from("proyectos")
      .update({ last_activity_at: new Date().toISOString(), updated_by: auth.usuarioCatalogId })
      .eq("empresa_id", auth.empresaId)
      .eq("id", pid);

    const row = Array.isArray(data) ? data[0] : data;
    return NextResponse.json(successResponse(row));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
