import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import {
  QA_COLOR_HEX_RE,
  QA_SECCION_SELECT,
  bumpProyectoActividad,
  esErrorSeccionDuplicada,
  registrarEventoQA,
  siguienteSortOrder,
  type QASeccionRow,
} from "@/lib/proyectos/qa-shared";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

  const { id } = await params;
  const pid = id?.trim() ?? "";
  if (!pid) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    const { data, error } = await sb
      .from("proyecto_qa_secciones")
      .select(QA_SECCION_SELECT)
      .eq("empresa_id", auth.empresaId)
      .eq("proyecto_id", pid)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    return NextResponse.json(successResponse({ secciones: (data ?? []) as QASeccionRow[] }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

  const { id } = await params;
  const pid = id?.trim() ?? "";
  if (!pid) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const nombre = typeof body?.nombre === "string" ? body.nombre.trim().slice(0, 120) : "";
    if (!nombre) return NextResponse.json(errorResponse("nombre obligatorio"), { status: 400 });

    const color = typeof body?.color === "string" ? body.color.trim() : "";
    if (color && !QA_COLOR_HEX_RE.test(color)) {
      return NextResponse.json(errorResponse("color debe ser hexadecimal, por ejemplo #4FAEB2"), {
        status: 400,
      });
    }

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    const sort_order = await siguienteSortOrder(sb, "proyecto_qa_secciones", auth.empresaId, {
      proyecto_id: pid,
    });

    const { data, error } = await sb
      .from("proyecto_qa_secciones")
      .insert({
        empresa_id: auth.empresaId,
        proyecto_id: pid,
        nombre,
        color: color || null,
        sort_order,
        created_by: auth.usuarioCatalogId,
      })
      .select(QA_SECCION_SELECT);

    if (error) {
      if (esErrorSeccionDuplicada(error)) {
        return NextResponse.json(errorResponse(`Ya existe una sección "${nombre}"`), { status: 409 });
      }
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }

    const row = (Array.isArray(data) ? data[0] : data) as QASeccionRow;

    await registrarEventoQA(sb, {
      empresaId: auth.empresaId,
      proyectoId: pid,
      usuarioId: auth.usuarioCatalogId,
      accion: "seccion_creada",
      payload: { id: row.id, nombre },
    });
    await bumpProyectoActividad(sb, auth.empresaId, pid, auth.usuarioCatalogId);

    return NextResponse.json(successResponse(row));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
