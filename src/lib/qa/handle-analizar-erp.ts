/**
 * Handler del botón "Analizar ERP completo".
 *
 * Crea (o reusa) el suite reservado "ai-discovery-<slug>" del proyecto con un
 * spec placeholder y encola un run. El claim adapter ve el prefijo del slug
 * y entrega el job al runner con safety_level=discovery + repo_url.
 *
 * El handler NO llama al LLM: toda la pipeline IA corre en el runner.
 * Acá sólo creamos el run y devolvemos la referencia.
 */

import type { QaRunsRepo } from "./repo-types";
import { codebaseDeProyecto, resolverRepoUrlProyecto } from "./pruebas-catalogo";

export type HandlerResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; body: { error: string; code: string } };

export type HandleAnalizarErpInput = {
  projectId: string;
  userId: string | null;
  clientRequestId: string | null;
  repo: QaRunsRepo;
};

export type HandleAnalizarErpOut = {
  run_id: string;
  suite_id: string;
  project_id: string;
  codebase: string;
};

const SPEC_PLACEHOLDER = "ai/discovery.pseudo";

export async function handleAnalizarErp(
  input: HandleAnalizarErpInput
): Promise<HandlerResult<HandleAnalizarErpOut>> {
  const project = await input.repo.getProject(input.projectId);
  if (!project) {
    return { ok: false, status: 404, body: { error: "proyecto no existe", code: "not_found" } };
  }
  if (project.estado_entrega === "entregado") {
    return {
      ok: false,
      status: 403,
      body: { error: "proyecto entregado — bloqueado para QA", code: "project_delivered" },
    };
  }
  const repoUrl = resolverRepoUrlProyecto(project.slug, project.repo_url ?? null);
  if (!repoUrl) {
    return {
      ok: false,
      status: 400,
      body: {
        error:
          "el proyecto no tiene repo_url ni override conocido — cargá el repositorio del ERP primero",
        code: "repo_url_missing",
      },
    };
  }
  const codebase = codebaseDeProyecto({ slug: project.slug });

  const suiteSlug = `ai-discovery-${project.slug}`;
  let suites = await input.repo.listSuitesForProject(project.id);
  let suite = suites.find((s) => s.slug === suiteSlug) ?? null;
  if (!suite) {
    const created = await input.repo.createSuite({
      project_id: project.id,
      slug: suiteSlug,
      name: `IA · Analizar ERP completo`,
      tags: ["ia", "discovery"],
      specs: [SPEC_PLACEHOLDER],
      enabled: true,
    });
    if ("conflict" in created) {
      return { ok: false, status: 500, body: { error: "no se pudo crear el suite IA", code: "internal" } };
    }
    suite = created;
  }

  const result = await input.repo.createRunAndJob({
    project,
    suite,
    triggered_by_user_id: input.userId,
    clientRequestId: input.clientRequestId,
  });

  return {
    ok: true,
    status: 201,
    body: {
      run_id: result.run.id,
      suite_id: suite.id,
      project_id: project.id,
      codebase,
    },
  };
}

export const AI_DISCOVERY_SUITE_PREFIX = "ai-discovery-";
export const AI_DISCOVERY_SPEC_PLACEHOLDER = SPEC_PLACEHOLDER;
