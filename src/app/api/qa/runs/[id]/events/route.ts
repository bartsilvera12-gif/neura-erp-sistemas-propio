/**
 * GET /api/qa/runs/[id]/events?since=<iso-ts>&limit=<n>
 *
 * Devuelve los eventos de progreso en vivo del agente QA para un run,
 * ordenados por ts ASC. La UI del run hace polling con el último `ts` ya
 * visto como `since` y agrega los nuevos al timeline sin duplicar.
 *
 * Auth: assertQaCenterAccess (mismo gate del panel QA Center).
 */

import { NextResponse } from "next/server";
import { assertQaCenterAccess } from "@/lib/qa/auth";
import { buildQaRepo } from "@/lib/qa/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LIMIT = 500;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await assertQaCenterAccess(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id debe ser UUID", code: "validation" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const sinceRaw = searchParams.get("since");
  const limitRaw = searchParams.get("limit");
  const since = sinceRaw && !Number.isNaN(Date.parse(sinceRaw)) ? new Date(sinceRaw) : null;
  const limit = (() => {
    const n = Number.parseInt(limitRaw ?? "", 10);
    if (!Number.isFinite(n) || n <= 0) return 200;
    return Math.min(n, MAX_LIMIT);
  })();

  const repo = buildQaRepo();
  if (!repo) return NextResponse.json({ error: "QA_DB_URL no configurada", code: "internal" }, { status: 500 });

  const run = await repo.getRun(id);
  if (!run) return NextResponse.json({ error: "no existe", code: "not_found" }, { status: 404 });

  const events = await repo.listRunEvents(id, { since, limit });
  return NextResponse.json(
    {
      data: events,
      run_status: run.status,
      last_ts: events.length > 0 ? events[events.length - 1].ts : null,
    },
    { status: 200 }
  );
}
