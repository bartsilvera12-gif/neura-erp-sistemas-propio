/**
 * NEURA QA CENTER — `GET /api/qa/runs/[id]` — detalle del run con resultados.
 */

import { NextResponse } from "next/server";
import { assertQaCenterAccess } from "@/lib/qa/auth";
import { buildQaRepo } from "@/lib/qa/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await assertQaCenterAccess(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "id debe ser UUID", code: "validation" }, { status: 400 });
  const repo = buildQaRepo();
  if (!repo) return NextResponse.json({ error: "QA_DB_URL no configurada", code: "internal" }, { status: 500 });

  const run = await repo.getRun(id);
  if (!run) return NextResponse.json({ error: "no existe", code: "not_found" }, { status: 404 });
  const results = await repo.listResultsForRun(id);
  const project = await repo.getProject(run.project_id);
  const suite = await repo.getSuite(run.suite_id);
  return NextResponse.json({ data: { run, results, project, suite } }, { status: 200 });
}
