import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { bumpProyectoActividad, registrarEventoQA } from "@/lib/proyectos/qa-shared";
import { notificarVeredictoQA } from "@/lib/proyectos/qa-notificaciones";
import { QA_ETAPA_FINAL } from "@/lib/proyectos/etapas-qa";

/**
 * POST /api/proyectos/[id]/qa/veredicto
 *
 * El cierre de una ronda de QA. No inventa un estado nuevo: mueve la misma
 * `qa_etapa` que usa el tablero del equipo, así no quedan dos nociones de "en
 * qué anda QA" que puedan contradecirse.
 *
 *   aprobado  -> qa_etapa = 'finalizado'  (sale del bloque activo de QA)
 *   rechazado -> qa_etapa = 'cambios'     (vuelve al programador)
 *
 * El motivo es obligatorio al rechazar: viaja en la notificación, y sin él el
 * programador tiene que entrar a adivinar qué corregir.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  const { id } = await params;
  const pid = id?.trim() ?? "";
  if (!pid) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json(errorResponse("Body inválido"), { status: 400 });
    }

    if (typeof body.aprobado !== "boolean") {
      return NextResponse.json(errorResponse("`aprobado` debe ser booleano"), { status: 400 });
    }
    const aprobado = body.aprobado;

    const motivo =
      typeof body.motivo === "string" && body.motivo.trim() ? body.motivo.trim() : null;
    if (!aprobado && !motivo) {
      return NextResponse.json(
        errorResponse("Indicá el motivo del rechazo"),
        { status: 400 }
      );
    }

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    const { data: actual, error: eActual } = await sb
      .from("proyectos")
      .select("id, qa_responsable_id")
      .eq("empresa_id", auth.empresaId)
      .eq("id", pid)
      .maybeSingle();
    if (eActual) return NextResponse.json(errorResponse(eActual.message), { status: 400 });
    if (!actual) return NextResponse.json(errorResponse("No encontrado"), { status: 404 });

    const ahora = new Date().toISOString();
    const { error: eUpdate } = await sb
      .from("proyectos")
      .update({
        qa_etapa: aprobado ? QA_ETAPA_FINAL : "cambios",
        qa_etapa_at: ahora,
        // Quien dictamina queda como responsable de QA aunque el proyecto no
        // tuviera QA asignada: sin esto el veredicto no tendría autor visible
        // en el tablero.
        qa_responsable_id:
          (actual as { qa_responsable_id?: string | null }).qa_responsable_id ??
          auth.usuarioCatalogId,
        updated_by: auth.usuarioCatalogId,
        last_activity_at: ahora,
      })
      .eq("empresa_id", auth.empresaId)
      .eq("id", pid);

    if (eUpdate) return NextResponse.json(errorResponse(eUpdate.message), { status: 400 });

    await registrarEventoQA(sb, {
      empresaId: auth.empresaId,
      proyectoId: pid,
      usuarioId: auth.usuarioCatalogId,
      accion: aprobado ? "qa_aprobado" : "qa_rechazado",
      payload: motivo ? { motivo } : {},
    });

    await notificarVeredictoQA(sb, {
      empresaId: auth.empresaId,
      proyectoId: pid,
      actorId: auth.usuarioCatalogId,
      aprobado,
      motivo,
    });

    await bumpProyectoActividad(sb, auth.empresaId, pid, auth.usuarioCatalogId);

    return NextResponse.json(
      successResponse({ id: pid, qa_etapa: aprobado ? QA_ETAPA_FINAL : "cambios", motivo })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
