import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireGuardiasAcceso } from "@/lib/guardias/guardias-auth";
import { esLunesValido } from "@/lib/guardias/semana";

type FilaSoporte = { pm_id: string | null; soporte_principal_id: string | null; soporte_suplente_id: string | null };

/**
 * POST /api/guardias/intercambiar — activa al suplente: el suplente pasa a
 * principal y el principal a suplente. (Proceso de Gestión de Soporte v1.4 §11.3)
 *
 * Body: { semana_inicio, motivo? }
 *
 * Lo pueden hacer los administradores y el PM de esa guardia, que es quien
 * coordina la cobertura. Queda registrado con fecha, motivo y quién lo hizo.
 * Los tickets nuevos de guardia van desde ese momento al nuevo principal.
 */
export async function POST(request: Request) {
  const auth = await requireGuardiasAcceso(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const semana = body?.semana_inicio;
    if (!esLunesValido(semana)) {
      return NextResponse.json(errorResponse("La semana tiene que empezar un lunes"), { status: 400 });
    }
    const motivo = typeof body?.motivo === "string" && body.motivo.trim() ? body.motivo.trim().slice(0, 500) : null;

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const { data } = await sb
      .from("guardias_semana")
      .select("pm_id, soporte_principal_id, soporte_suplente_id")
      .eq("empresa_id", auth.empresaId)
      .eq("semana_inicio", semana)
      .maybeSingle();
    const g = data as FilaSoporte | null;
    if (!g) return NextResponse.json(errorResponse("Esa semana no tiene guardia asignada"), { status: 404 });
    if (!g.soporte_principal_id || !g.soporte_suplente_id) {
      return NextResponse.json(errorResponse("Para intercambiar hacen falta principal y suplente"), { status: 400 });
    }

    const esPmDeGuardia = g.pm_id === auth.usuarioCatalogId;
    if (!auth.esAdmin && !esPmDeGuardia) {
      return NextResponse.json(errorResponse("Sólo el PM de guardia o un administrador pueden intercambiar"), {
        status: 403,
      });
    }

    // Sólo si nadie lo cambió mientras tanto: dos clics simultáneos no se deshacen entre sí.
    const { data: actualizada, error } = await sb
      .from("guardias_semana")
      .update({
        soporte_principal_id: g.soporte_suplente_id,
        soporte_suplente_id: g.soporte_principal_id,
        updated_by: auth.usuarioCatalogId,
        updated_at: new Date().toISOString(),
      })
      .eq("empresa_id", auth.empresaId)
      .eq("semana_inicio", semana)
      .eq("soporte_principal_id", g.soporte_principal_id)
      .eq("soporte_suplente_id", g.soporte_suplente_id)
      .select("id")
      .maybeSingle();
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    if (!actualizada) {
      return NextResponse.json(errorResponse("La guardia cambió mientras tanto. Actualizá y volvé a intentar."), { status: 409 });
    }

    const { error: errLog } = await sb.from("guardias_intercambios").insert({
      empresa_id: auth.empresaId,
      semana_inicio: semana,
      principal_anterior_id: g.soporte_principal_id,
      principal_nuevo_id: g.soporte_suplente_id,
      motivo,
      realizado_por: auth.usuarioCatalogId,
    });
    if (errLog) console.error("[guardias] no se pudo registrar el intercambio", errLog.message);

    return NextResponse.json(
      successResponse({ soporte_principal_id: g.soporte_suplente_id, soporte_suplente_id: g.soporte_principal_id })
    );
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error"), { status: 500 });
  }
}
