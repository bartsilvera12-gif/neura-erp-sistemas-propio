/**
 * NEURA QA CENTER — `GET /api/qa/pruebas-disponibles?project=<uuid>`
 *
 * Devuelve el catálogo de pruebas disponibles filtradas por compatibilidad
 * con el proyecto indicado. Es la única fuente que la UI consume para armar
 * el selector de pruebas (no permitimos tipear nombres de spec a mano).
 */

import { NextResponse } from "next/server";
import { assertQaCenterAccess } from "@/lib/qa/auth";
import { buildQaRepo } from "@/lib/qa/route-helpers";
import { pruebasParaProyecto } from "@/lib/qa/pruebas-catalogo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const auth = await assertQaCenterAccess(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const projectId = url.searchParams.get("project");
  if (!projectId || !UUID_RE.test(projectId)) {
    return NextResponse.json(
      { error: "project (UUID) requerido", code: "validation" },
      { status: 400 }
    );
  }

  const repo = buildQaRepo();
  if (!repo) {
    return NextResponse.json({ error: "QA_DB_URL no configurada", code: "internal" }, { status: 500 });
  }
  const project = await repo.getProject(projectId);
  if (!project) {
    return NextResponse.json({ error: "proyecto no existe", code: "not_found" }, { status: 404 });
  }

  const grupos = pruebasParaProyecto({
    slug: project.slug,
    target_base_url: project.target_base_url,
    target_env: project.target_env,
  });
  const total = grupos.reduce((n, g) => n + g.pruebas.length, 0);

  return NextResponse.json(
    { data: { grupos, total } },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
