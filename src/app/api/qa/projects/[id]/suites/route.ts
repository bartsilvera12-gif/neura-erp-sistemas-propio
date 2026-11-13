/**
 * NEURA QA CENTER — `GET/POST /api/qa/projects/[id]/suites`.
 */

import { NextResponse } from "next/server";
import { assertQaCenterAccess } from "@/lib/qa/auth";
import { buildQaRepo } from "@/lib/qa/route-helpers";
import { validateSlug, validateSpecs } from "@/lib/qa/target-validation";
import { specsPermitidas } from "@/lib/qa/pruebas-catalogo";

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
  if (!project) return NextResponse.json({ error: "proyecto no existe", code: "not_found" }, { status: 404 });
  const suites = await repo.listSuitesForProject(id);
  return NextResponse.json({ data: suites, migration_status: "ready" }, { status: 200 });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await assertQaCenterAccess(request);
  if (!auth.ok) return auth.response;
  const { id: projectId } = await context.params;
  if (!UUID_RE.test(projectId)) {
    return NextResponse.json({ error: "id debe ser UUID", code: "validation" }, { status: 400 });
  }
  const repo = buildQaRepo();
  if (!repo) return NextResponse.json({ error: "QA_DB_URL no configurada", code: "internal" }, { status: 500 });

  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "JSON inválido", code: "validation" }, { status: 400 }); }

  const slugV = validateSlug(body.slug);
  if (!slugV.ok) return NextResponse.json({ error: slugV.reason, code: "validation", field: "slug" }, { status: 400 });

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 2 || name.length > 80) {
    return NextResponse.json({ error: "name 2-80 chars", code: "validation", field: "name" }, { status: 400 });
  }

  const specsV = validateSpecs(body.specs);
  if (!specsV.ok) return NextResponse.json({ error: specsV.reason, code: "validation", field: "specs" }, { status: 400 });

  // Whitelist estricta: cada spec debe existir en el catálogo autorizado.
  // Impide que la UI (o un cliente con token) registre specs arbitrarios
  // aunque pasen el regex de validateSpecs().
  const autorizadas = specsPermitidas();
  const noAutorizadas = specsV.specs.filter((s) => !autorizadas.has(s));
  if (noAutorizadas.length > 0) {
    return NextResponse.json(
      {
        error: `las siguientes pruebas no están en el catálogo autorizado: ${noAutorizadas.join(", ")}`,
        code: "validation",
        field: "specs",
      },
      { status: 400 }
    );
  }

  const tagsRaw = Array.isArray(body.tags) ? body.tags : [];
  const tags = tagsRaw.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean).slice(0, 10);

  const description = typeof body.description === "string" ? body.description.trim().slice(0, 500) : null;

  const result = await repo.createSuite({
    project_id: projectId,
    slug: slugV.slug,
    name,
    description,
    tags,
    specs: specsV.specs,
    enabled: body.enabled === false ? false : true,
  });
  if ("conflict" in result) {
    if (result.conflict === "project_not_found") {
      return NextResponse.json({ error: "proyecto no existe", code: "not_found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "ya existe un suite con ese slug en este proyecto", code: "conflict", field: "slug" },
      { status: 409 }
    );
  }
  return NextResponse.json({ data: result }, { status: 201 });
}
