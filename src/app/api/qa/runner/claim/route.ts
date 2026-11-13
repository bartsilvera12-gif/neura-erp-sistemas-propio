/**
 * NEURA QA CENTER — `POST /api/qa/runner/claim`
 * Toma el próximo job unclaimed. Autenticación por HMAC del runner.
 */

import { NextResponse } from "next/server";
import { authenticateRunner } from "@/lib/qa/runner-auth";
import { handleClaim } from "@/lib/qa/handlers";
import { buildQaNonceStore, buildQaRepo } from "@/lib/qa/route-helpers";
import { nivelSeguridadDeSpecs, resolverRepoUrlProyecto, codebaseDeProyecto } from "@/lib/qa/pruebas-catalogo";
import { AI_DISCOVERY_SUITE_PREFIX } from "@/lib/qa/handle-analizar-erp";

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
  // Suite de IA "Analizar ERP completo": slug `ai-discovery-<proyecto>`.
  // En ese caso el run corre en modo discovery (clone + descubrir + LLM).
  const esSuiteIaDiscovery = suite.slug.startsWith(AI_DISCOVERY_SUITE_PREFIX);

  // Nivel de seguridad agregado desde el catálogo. Si devuelve null o un
  // nivel no corrible ("mixed_analysis", "write_required"), en teoría el
  // handleCreateRun ya lo rechazó: acá, por safety, mapeamos a "standard".
  const nivelCat = nivelSeguridadDeSpecs(suite.specs);
  const safety_level:
    | "static_analysis"
    | "discovery"
    | "anonymous_read_only"
    | "authenticated_read_only"
    | "standard" = esSuiteIaDiscovery
    ? "discovery"
    : nivelCat === "static_analysis" ||
      nivelCat === "anonymous_read_only" ||
      nivelCat === "authenticated_read_only"
      ? nivelCat
      : "standard";
  const mode: "read-only" | "write" | "static-analysis" | "discovery" =
    safety_level === "discovery"
      ? "discovery"
      : safety_level === "static_analysis"
      ? "static-analysis"
      : "read-only";
  const repo_url =
    safety_level === "static_analysis" || safety_level === "discovery"
      ? resolverRepoUrlProyecto(project.slug, project.repo_url ?? null)
      : null;
  const codebase = codebaseDeProyecto({ slug: project.slug });
  // El runner saltea env-assert sólo para authenticated_read_only cuando el
  // admin del proyecto lo autorizó. El flag llega desde la DB del proyecto.
  const skip_env_assert =
    safety_level === "authenticated_read_only" &&
    project.permite_lectura_sin_env_assert === true;

  // Para discovery conservamos target_base_url: el runner necesita conocer el
  // dominio real para ejecutar los specs IA generados. La ejecución sólo se
  // dispara si (a) permite_lectura_sin_env_assert=true, o (b) env-assert
  // responde con lectura_autenticada_safe. En ambos casos el runner aplica
  // el sandbox network-intercept que confina al host del baseUrl.
  const target_base_url_final =
    safety_level === "static_analysis" ? "" : run.target_base_url;

  // Para discovery permitimos skip_env_assert cuando el admin lo autorizó.
  const skip_env_assert_final =
    (safety_level === "authenticated_read_only" ||
      safety_level === "discovery") &&
    project.permite_lectura_sin_env_assert === true
      ? true
      : skip_env_assert;

  const flat = {
    job_id: job.id,
    run_id: run.id,
    project_id: run.project_id,
    suite_slug: suite.slug,
    target_base_url: target_base_url_final,
    target_env: run.target_env,
    mode,
    safety_level,
    skip_env_assert: skip_env_assert_final,
    ...(repo_url ? { repo_url, repo_branch: project.default_branch ?? "main" } : {}),
    codebase,
    specs: suite.specs,
    created_at:
      typeof job.created_at === "string"
        ? job.created_at
        : (job.created_at as unknown as Date).toISOString(),
  };
  return NextResponse.json(flat, { status: result.status });
}
