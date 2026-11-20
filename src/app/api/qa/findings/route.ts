/**
 * NEURA QA CENTER — `GET /api/qa/findings`
 * Lista hallazgos (findings) registrados para revisión en el panel.
 * Ordenados por severidad descendente (blocker→info) y recencia.
 */

import { NextResponse } from "next/server";
import { assertQaCenterAccess } from "@/lib/qa/auth";
import { buildQaRepo } from "@/lib/qa/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const auth = await assertQaCenterAccess(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const projectId = url.searchParams.get("project") ?? undefined;
  if (projectId && !UUID_RE.test(projectId)) {
    return NextResponse.json({ error: "project debe ser UUID", code: "validation" }, { status: 400 });
  }
  const limitRaw = url.searchParams.get("limit");
  let limit = 50;
  if (limitRaw !== null) {
    const parsed = Number.parseInt(limitRaw, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 200) {
      return NextResponse.json({ error: "limit entre 1 y 200", code: "validation" }, { status: 400 });
    }
    limit = parsed;
  }

  const repo = buildQaRepo();
  if (!repo) return NextResponse.json({ error: "QA_DB_URL no configurada", code: "internal" }, { status: 500 });

  try {
    const data = await repo.listFindings({ projectId, limit });
    return NextResponse.json({ data }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error inesperado";
    return NextResponse.json({ error: msg, code: "internal" }, { status: 500 });
  }
}
