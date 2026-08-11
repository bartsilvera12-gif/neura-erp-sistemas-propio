import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { bumpProyectoActividad, registrarEventoQA } from "@/lib/proyectos/qa-shared";

type Movimiento = { id: string; sort_order: number };

function parseMovimientos(body: unknown): Movimiento[] {
  const lista = Array.isArray(body) ? body : Array.isArray((body as { items?: unknown })?.items) ? (body as { items: unknown[] }).items : null;
  if (!lista) return [];
  const out: Movimiento[] = [];
  for (const raw of lista) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as { id?: unknown; sort_order?: unknown };
    const id = typeof r.id === "string" ? r.id.trim() : "";
    const sort = typeof r.sort_order === "number" && Number.isFinite(r.sort_order) ? Math.floor(r.sort_order) : null;
    if (id && sort !== null) out.push({ id, sort_order: sort });
  }
  return out;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

  const { id } = await params;
  const pid = id?.trim() ?? "";
  if (!pid) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

  try {
    const movimientos = parseMovimientos(await request.json().catch(() => null));
    if (movimientos.length === 0) {
      return NextResponse.json(errorResponse("Nada para reordenar"), { status: 400 });
    }
    if (movimientos.length > 500) {
      return NextResponse.json(errorResponse("Demasiadas filas en un solo reordenamiento"), { status: 400 });
    }

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    // Un UPDATE por fila, siempre acotado a la empresa + proyecto de la request:
    // un id ajeno simplemente no matchea y no se toca nada.
    for (const m of movimientos) {
      const { error } = await sb
        .from("proyecto_qa_observaciones")
        .update({ sort_order: m.sort_order })
        .eq("empresa_id", auth.empresaId)
        .eq("proyecto_id", pid)
        .eq("id", m.id);
      if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    }

    await registrarEventoQA(sb, {
      empresaId: auth.empresaId,
      proyectoId: pid,
      usuarioId: auth.usuarioCatalogId,
      accion: "observacion_editada",
      payload: { reordenadas: movimientos.length },
    });
    await bumpProyectoActividad(sb, auth.empresaId, pid, auth.usuarioCatalogId);

    return NextResponse.json(successResponse({ actualizadas: movimientos.length }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
