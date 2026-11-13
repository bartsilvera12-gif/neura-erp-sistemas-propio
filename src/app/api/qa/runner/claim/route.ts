/**
 * NEURA QA CENTER — `POST /api/qa/runner/claim`
 * Toma el próximo job unclaimed. Autenticación por HMAC del runner.
 */

import { NextResponse } from "next/server";
import { authenticateRunner } from "@/lib/qa/runner-auth";
import { handleClaim } from "@/lib/qa/handlers";
import { buildQaNonceStore, buildQaRepo } from "@/lib/qa/route-helpers";
import { nivelSeguridadDeSpecs, resolverRepoUrlProyecto } from "@/lib/qa/pruebas-catalogo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const nonceStore = buildQaNonceStore();
  if (!nonceStore) {
    return NextResponse.json({ error: "QA_DB_URL no configurada o Postgres inalcanzable", code: "internal" }, { status: 500 });
  }
  const auth = await authenticateRunner(request, nonceStore);
  if (!auth.ok) return auth.response;

  const repo = buildQaRepo();
  if (!repo) {
    return NextResponse.json({ error: "QA_DB_URL no configurada o Postgres inalcanzable", code: "internal" }, { status: 500 });
  }
  const result = await handleClaim({ runnerId: auth.runnerId, repo });
  if (result.body === null) return new NextResponse(null, { status: 204 });
  if (!result.ok || !("job" in result.body)) {
    return NextResponse.json(result.body, { status: result.status });
  }

  const { job, run, suite, project } = result.body;
  // Nivel de seguridad agregado desde el catálogo. Si devuelve null o un
  // nivel no corrible ("mixed_analysis", "write_required"), en teoría el
  // handleCreateRun ya lo rechazó: acá, por safety, mapeamos a "standard".
  const nivel = nivelSeguridadDeSpecs(suite.specs);
  const safety_level:
    | "static_analysis"
    | "anonymous_read_only"
    | "authenticated_read_only"
    | "standard" =
    nivel === "static_analysis" ||
    nivel === "anonymous_read_only" ||
    nivel === "authenticated_read_only"
      ? nivel
      : "standard";
  const mode: "read-only" | "write" | "static-analysis" =
    safety_level === "static_analysis" ? "static-analysis" : "read-only";
  const repo_url =
    safety_level === "static_analysis"
      ? resolverRepoUrlProyecto(project.slug, project.repo_url ?? null)
      : null;
  // El runner saltea env-assert sólo para authenticated_read_only cuando el
  // admin del proyecto lo autorizó. El flag llega desde la DB del proyecto.
  const skip_env_assert =
    safety_level === "authenticated_read_only" &&
    project.permite_lectura_sin_env_assert === true;

  const flat = {
    job_id: job.id,
    run_id: run.id,
    project_id: run.project_id,
    suite_slug: suite.slug,
    target_base_url: safety_level === "static_analysis" ? "" : run.target_base_url,
    target_env: run.target_env,
    mode,
    safety_level,
    skip_env_assert,
    ...(repo_url ? { repo_url, repo_branch: project.default_branch ?? "main" } : {}),
    specs: suite.specs,
    created_at:
      typeof job.created_at === "string"
        ? job.created_at
        : (job.created_at as unknown as Date).toISOString(),
  };
  return NextResponse.json(flat, { status: result.status });
}
