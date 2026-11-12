/**
 * NEURA QA CENTER — `GET/PATCH /api/qa/projects/[id]`.
 */

import { NextResponse } from "next/server";
import { assertQaCenterAccess } from "@/lib/qa/auth";
import { buildQaRepo } from "@/lib/qa/route-helpers";
import { validateTargetBaseUrl } from "@/lib/qa/target-validation";

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
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id debe ser UUID", code: "validation" }, { status: 400 });
  }
  const repo = buildQaRepo();
  if (!repo) return NextResponse.json({ error: "QA_DB_URL no configurada", code: "internal" }, { status: 500 });

  const project = await repo.getProject(id);
  if (!project) return NextResponse.json({ error: "no existe", code: "not_found" }, { status: 404 });
  return NextResponse.json({ data: project }, { status: 200 });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await assertQaCenterAccess(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id debe ser UUID", code: "validation" }, { status: 400 });
  }
  const repo = buildQaRepo();
  if (!repo) return NextResponse.json({ error: "QA_DB_URL no configurada", code: "internal" }, { status: 500 });

  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "JSON inválido", code: "validation" }, { status: 400 }); }

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") {
    const n = body.name.trim();
    if (n.length < 2 || n.length > 80) {
      return NextResponse.json({ error: "name 2-80 chars", code: "validation", field: "name" }, { status: 400 });
    }
    patch.name = n;
  }
  if (typeof body.default_branch === "string" && body.default_branch.trim()) {
    patch.default_branch = body.default_branch.trim();
  }
  let target_env: "staging" | "preview" | "local" | undefined;
  if (body.target_env !== undefined) {
    if (!["staging", "preview", "local"].includes(String(body.target_env))) {
      return NextResponse.json({ error: "target_env inválido", code: "validation", field: "target_env" }, { status: 400 });
    }
    target_env = body.target_env as typeof target_env;
    patch.target_env = target_env;
  }
  if (body.target_base_url !== undefined) {
    const envForCheck = target_env ?? (await repo.getProject(id))?.target_env ?? "staging";
    const v = validateTargetBaseUrl(String(body.target_base_url), envForCheck);
    if (!v.ok) {
      return NextResponse.json({ error: v.reason, code: "validation", field: "target_base_url" }, { status: 400 });
    }
    patch.target_base_url = String(body.target_base_url).trim();
  }

  const updated = await repo.updateProject(id, patch as Parameters<typeof repo.updateProject>[1]);
  if (!updated) return NextResponse.json({ error: "no existe", code: "not_found" }, { status: 404 });
  return NextResponse.json({ data: updated }, { status: 200 });
}
