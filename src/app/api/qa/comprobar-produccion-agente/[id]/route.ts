/**
 * Inicia una corrida REAL de Playwright contra el ERP PUBLICADO de Açaí House.
 * Sólo navegación/lectura GET. No utiliza sandbox y no realiza escrituras.
 * Seguridad: acceso QA autenticado + repo y hostname exactos (fail-closed).
 */
import { NextResponse } from "next/server";
import { assertQaCenterAccess } from "@/lib/qa/auth";
import { buildQaRepo } from "@/lib/qa/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUITE_SLUG = "ai-production-readonly-acai-house";
const SPEC = "production/acai-public-readonly.spec.ts";
const REPO = "https://github.com/bartsilvera12-gif/acai-house";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await assertQaCenterAccess(request);
    if (!auth.ok) return auth.response;
    const { id } = await context.params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    const repo = buildQaRepo();
    if (!repo) return NextResponse.json({ error: "QA_DB_URL no configurada" }, { status: 503 });
    const project = await repo.getProject(id);
    if (!project) return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });

    const repository = (project.repo_url ?? "").trim().replace(/\/$/, "").replace(/\.git$/, "").toLowerCase();
    if (repository !== REPO) {
      return NextResponse.json({ error: "Solo se permite el repositorio Açaí House" }, { status: 403 });
    }
    let target: URL;
    try { target = new URL(project.target_base_url); }
    catch { return NextResponse.json({ error: "Configurar URL publicada de Açaí House" }, { status: 400 }); }
    if (target.protocol !== "https:" || target.hostname !== "acaihouse.neura.com.py" || target.port || target.username || target.password) {
      return NextResponse.json({ error: "El destino debe ser https://acaihouse.neura.com.py/" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({})) as { clientRequestId?: unknown };
    const clientRequestId = typeof body.clientRequestId === "string" && body.clientRequestId.length <= 128
      ? body.clientRequestId : null;
    const suites = await repo.listSuitesForProject(project.id);
    let suite = suites.find((s) => s.slug === SUITE_SLUG) ?? null;
    if (!suite) {
      const created = await repo.createSuite({
        project_id: project.id,
        slug: SUITE_SLUG,
        name: "Açaí House publicado · Playwright lectura",
        tags: ["produccion", "playwright", "solo-lectura"],
        specs: [SPEC],
        enabled: true,
      });
      if ("conflict" in created) {
        // En caso de petición paralela, resolver la suite creada por la otra.
        suite = (await repo.listSuitesForProject(project.id)).find((s) => s.slug === SUITE_SLUG) ?? null;
        if (!suite) return NextResponse.json({ error: "No se pudo crear la suite" }, { status: 409 });
      } else suite = created;
    }
    // Nunca ejecutar una suite preexistente que cambió sus specs o permisos.
    if (!suite.enabled || suite.specs.length !== 1 || suite.specs[0] !== SPEC) {
      return NextResponse.json({ error: "La suite reservada fue modificada; ejecución bloqueada" }, { status: 409 });
    }
    const result = await repo.createRunAndJob({
      project, suite, triggered_by_user_id: auth.user.id, clientRequestId,
    });
    return NextResponse.json({
      run_id: result.run.id,
      project_id: project.id,
      mode: "production_read_only",
      note: "Playwright sobre Açaí House publicado. GET únicamente. Sin ventas ni cambios de stock.",
    }, { status: 201 });
  } catch (error) {
    console.error("[QA producción Açaí] fallo al encolar", error);
    return NextResponse.json({ error: "Error al crear ejecución de QA" }, { status: 500 });
  }
}
