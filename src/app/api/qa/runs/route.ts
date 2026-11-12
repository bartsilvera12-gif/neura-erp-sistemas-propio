/**
 * NEURA QA CENTER — `GET /api/qa/runs`
 * Lista últimas corridas. Opcionalmente filtra por `?project=<uuid>`.
 * Solo super_admin (gating server-side).
 *
 * Si la migración aún no corrió, responde con `data: []` + `migration_status`.
 */

import { NextResponse } from "next/server";
import { assertSuperAdmin } from "@/lib/qa/auth";
import { listQaRuns } from "@/lib/qa/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const auth = await assertSuperAdmin(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const projectId = url.searchParams.get("project") ?? undefined;
  if (projectId && !UUID_RE.test(projectId)) {
    return NextResponse.json(
      { error: "project debe ser UUID", code: "validation" },
      { status: 400 }
    );
  }
  const limitRaw = url.searchParams.get("limit");
  let limit = 25;
  if (limitRaw !== null) {
    const parsed = Number.parseInt(limitRaw, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) {
      return NextResponse.json(
        { error: "limit debe estar entre 1 y 100", code: "validation" },
        { status: 400 }
      );
    }
    limit = parsed;
  }

  try {
    const result = await listQaRuns(auth.serviceClient, { projectId, limit });
    return NextResponse.json(result, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error inesperado";
    return NextResponse.json({ error: msg, code: "internal" }, { status: 500 });
  }
}
