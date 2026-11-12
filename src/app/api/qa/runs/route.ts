/**
 * NEURA QA CENTER — `/api/qa/runs`
 *   GET  → lista últimas corridas (super_admin).
 *   POST → crea un run + runner_job desde el panel (super_admin).
 *
 * El `target_base_url` del run proviene del proyecto, no del request:
 * el panel no puede especificar destinos arbitrarios.
 */

import { NextResponse } from "next/server";
import { assertSuperAdmin } from "@/lib/qa/auth";
import { listQaRuns } from "@/lib/qa/db";
import { handleCreateRun } from "@/lib/qa/handlers";
import { buildSupabaseRepo } from "@/lib/qa/route-helpers";

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

export async function POST(request: Request) {
  const auth = await assertSuperAdmin(request);
  if (!auth.ok) return auth.response;

  const repo = buildSupabaseRepo();
  if (!repo) {
    return NextResponse.json(
      { error: "Config Supabase no disponible", code: "internal" },
      { status: 500 }
    );
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido", code: "validation" }, { status: 400 });
  }

  const result = await handleCreateRun({ body, userId: auth.user.id, repo });
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
