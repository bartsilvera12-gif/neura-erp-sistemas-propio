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
  type QASeccionRow,
  type QASupabase,
} from "@/lib/proyectos/qa-shared";

async function fetchSeccion(
  sb: QASupabase,
  empresaId: string,
  proyectoId: string,
  seccionId: string
): Promise<QASeccionRow | null> {
  const { data, error } = await sb
    .from("proyecto_qa_secciones")
    .select(QA_SECCION_SELECT)
    .eq("empresa_id", empresaId)
    .eq("proyecto_id", proyectoId)
    .eq("id", seccionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as QASeccionRow | null) ?? null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; seccionId: string }> }
) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

  const { id, seccionId } = await params;
  const pid = id?.trim() ?? "";
  const sid = seccionId?.trim() ?? "";
  if (!pid || !sid) return NextResponse.json(errorResponse("ids obligatorios"), { status: 400 });

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json(errorResponse("Body inválido"), { status: 400 });

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const prev = await fetchSeccion(sb, auth.empresaId, pid, sid);
    if (!prev) return NextResponse.json(errorResponse("Sección no encontrada"), { status: 404 });

    const patch: Record<string, unknown> = {};

    if (typeof body.nombre === "string") {
      const n = body.nombre.trim().slice(0, 120);
      if (!n) return NextResponse.json(errorResponse("nombre vacío"), { status: 400 });
      if (n !== prev.nombre) patch.nombre = n;
    }

    if (Object.prototype.hasOwnProperty.call(body, "color")) {
      const c = typeof body.color === "string" ? body.color.trim() : "";
      if (c && !QA_COLOR_HEX_RE.test(c)) {
        return NextResponse.json(errorResponse("color debe ser hexadecimal, por ejemplo #4FAEB2"), {
          status: 400,
        });
      }
      const nuevo = c || null;
      if (nuevo !== prev.color) patch.color = nuevo;
    }

    if (typeof body.sort_order === "number" && Number.isFinite(body.sort_order)) {
      patch.sort_order = Math.floor(body.sort_order);
    }

    if (Object.keys(patch).length === 0) return NextResponse.json(successResponse(prev));

    const { data, error } = await sb
      .from("proyecto_qa_secciones")
      .update(patch)
      .eq("empresa_id", auth.empresaId)
      .eq("proyecto_id", pid)
      .eq("id", sid)
      .select(QA_SECCION_SELECT);
    if (error) {
      if (esErrorSeccionDuplicada(error)) {
        return NextResponse.json(errorResponse("Ya existe una sección con ese nombre"), { status: 409 });
      }
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }

    await registrarEventoQA(sb, {
      empresaId: auth.empresaId,
      proyectoId: pid,
      usuarioId: auth.usuarioCatalogId,
      accion: "seccion_editada",
      payload: { id: sid, antes: prev.nombre, cambios: Object.keys(patch) },
    });
    await bumpProyectoActividad(sb, auth.empresaId, pid, auth.usuarioCatalogId);

    return NextResponse.json(successResponse((Array.isArray(data) ? data[0] : data) as QASeccionRow));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; seccionId: string }> }
) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

  const { id, seccionId } = await params;
  const pid = id?.trim() ?? "";
  const sid = seccionId?.trim() ?? "";
  if (!pid || !sid) return NextResponse.json(errorResponse("ids obligatorios"), { status: 400 });

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const prev = await fetchSeccion(sb, auth.empresaId, pid, sid);
    if (!prev) return NextResponse.json(errorResponse("Sección no encontrada"), { status: 404 });

    // Las observaciones no se borran: el FK es ON DELETE SET NULL y quedan
    // agrupadas en "Sin sección".
    const { error } = await sb
      .from("proyecto_qa_secciones")
      .delete()
      .eq("empresa_id", auth.empresaId)
      .eq("proyecto_id", pid)
      .eq("id", sid);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    await registrarEventoQA(sb, {
      empresaId: auth.empresaId,
      proyectoId: pid,
      usuarioId: auth.usuarioCatalogId,
      accion: "seccion_eliminada",
      payload: { id: sid, nombre: prev.nombre },
    });
    await bumpProyectoActividad(sb, auth.empresaId, pid, auth.usuarioCatalogId);

    return NextResponse.json(successResponse({ id: sid }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
