/**
 * NEURA QA CENTER — `GET /api/qa/projects` (lista) + `POST /api/qa/projects` (crear).
 * Gating: QA member (super_admin o Neura QA). No service_role.
 */

import { NextResponse } from "next/server";
import { assertQaCenterAccess } from "@/lib/qa/auth";
import { listQaProjects } from "@/lib/qa/db";
import { buildQaRepo } from "@/lib/qa/route-helpers";
import {
  validateTargetBaseUrl,
  validateSlug,
} from "@/lib/qa/target-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await assertQaCenterAccess(request);
  if (!auth.ok) return auth.response;

  try {
    const result = await listQaProjects();
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
  const auth = await assertQaCenterAccess(request);
  if (!auth.ok) return auth.response;

  const repo = buildQaRepo();
  if (!repo) {
    return NextResponse.json(
      { error: "QA_DB_URL no configurada", code: "internal" },
      { status: 500 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido", code: "validation" }, { status: 400 });
  }

  const slugV = validateSlug(body.slug);
  if (!slugV.ok) {
    return NextResponse.json({ error: slugV.reason, code: "validation", field: "slug" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 2 || name.length > 80) {
    return NextResponse.json({ error: "name 2-80 chars", code: "validation", field: "name" }, { status: 400 });
  }
  const target_env = body.target_env as "staging" | "preview" | "local";
  if (!["staging", "preview", "local"].includes(target_env)) {
    return NextResponse.json({ error: "target_env inválido", code: "validation", field: "target_env" }, { status: 400 });
  }
  const targetV = validateTargetBaseUrl(String(body.target_base_url ?? ""), target_env);
  if (!targetV.ok) {
    return NextResponse.json(
      { error: targetV.reason, code: "validation", field: "target_base_url" },
      { status: 400 }
    );
  }

  const default_branch = typeof body.default_branch === "string" && body.default_branch.trim()
    ? body.default_branch.trim()
    : "main";

  const result = await repo.createProject({
    slug: slugV.slug,
    name,
    target_base_url: String(body.target_base_url).trim(),
    target_env,
    default_branch,
    owner_user_id: auth.user.id,
  });
  if ("conflict" in result) {
    return NextResponse.json(
      { error: "Ya existe un proyecto con ese slug", code: "conflict", field: "slug" },
      { status: 409 }
    );
  }
  return NextResponse.json({ data: result }, { status: 201 });
}
