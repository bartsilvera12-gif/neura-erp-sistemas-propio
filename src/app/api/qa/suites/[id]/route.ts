/**
 * NEURA QA CENTER — `GET/PATCH /api/qa/suites/[id]`.
 */

import { NextResponse } from "next/server";
import { assertQaCenterAccess } from "@/lib/qa/auth";
import { buildQaRepo } from "@/lib/qa/route-helpers";
import { validateSpecs } from "@/lib/qa/target-validation";

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
  const suite = await repo.getSuite(id);
  if (!suite) return NextResponse.json({ error: "no existe", code: "not_found" }, { status: 404 });
  return NextResponse.json({ data: suite }, { status: 200 });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await assertQaCenterAccess(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "id debe ser UUID", code: "validation" }, { status: 400 });
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
  if (Array.isArray(body.tags)) {
    patch.tags = body.tags
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 10);
  }
  if (body.specs !== undefined) {
    const v = validateSpecs(body.specs);
    if (!v.ok) return NextResponse.json({ error: v.reason, code: "validation", field: "specs" }, { status: 400 });
    patch.specs = v.specs;
  }
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;

  const updated = await repo.updateSuite(id, patch as Parameters<typeof repo.updateSuite>[1]);
  if (!updated) return NextResponse.json({ error: "no existe", code: "not_found" }, { status: 404 });
  return NextResponse.json({ data: updated }, { status: 200 });
}
