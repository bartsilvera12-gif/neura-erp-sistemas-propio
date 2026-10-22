import { NextRequest, NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api/response";
import {
  repoListQueueRubros,
  repoReplaceQueueRubros,
  type QueueRubroInput,
} from "@/lib/chat/queue-admin-repo";
import { normalizeQueueRouteId, resolveQueueAdminTenantContext } from "../../_tenant-ctx";

export async function GET(request: NextRequest, ctx: { params: Promise<{ queueId: string }> }) {
  const resolved = await resolveQueueAdminTenantContext(request);
  if (!resolved) {
    return NextResponse.json(errorResponse("No autorizado"), { status: 401 });
  }
  const params = await ctx.params;
  const queueId = normalizeQueueRouteId(params.queueId);
  if (!queueId) {
    return NextResponse.json(errorResponse("Identificador de cola inválido"), { status: 400 });
  }
  try {
    const rows = await repoListQueueRubros(resolved.ctx, queueId);
    return NextResponse.json(successResponse(rows));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al cargar rubros";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function PUT(request: NextRequest, ctx: { params: Promise<{ queueId: string }> }) {
  const resolved = await resolveQueueAdminTenantContext(request);
  if (!resolved) {
    return NextResponse.json(errorResponse("No autorizado"), { status: 401 });
  }
  const params = await ctx.params;
  const queueId = normalizeQueueRouteId(params.queueId);
  if (!queueId) {
    return NextResponse.json(errorResponse("Identificador de cola inválido"), { status: 400 });
  }
  try {
    const body = (await request.json().catch(() => null)) as { rubros?: QueueRubroInput[] } | null;
    const rubros = Array.isArray(body?.rubros) ? body!.rubros! : [];
    await repoReplaceQueueRubros(resolved.ctx, queueId, rubros);
    return NextResponse.json(successResponse(true));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al guardar rubros";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
