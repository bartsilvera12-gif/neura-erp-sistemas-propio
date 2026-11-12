/**
 * NEURA QA CENTER — `POST /api/qa/runner/claim`
 * Toma el próximo job unclaimed. Autenticación por HMAC del runner.
 */

import { NextResponse } from "next/server";
import { authenticateRunner } from "@/lib/qa/runner-auth";
import { handleClaim } from "@/lib/qa/handlers";
import { buildQaNonceStore, buildQaRepo } from "@/lib/qa/route-helpers";

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
  // Guard explícito: handleClaim es `HandlerResult<ClaimedJob | null>` cuyo
  // body puede ser también `{error, code, detail}` si se agrega una rama de
  // error en el handler. Antes del destructure confirmamos que es el shape
  // ClaimedJob — fail-closed: cualquier otra forma se pasa tal cual al runner.
  if (!result.ok || !("job" in result.body)) {
    return NextResponse.json(result.body, { status: result.status });
  }

  // Adaptador al contrato wire del runner (flat). El handler devuelve
  // {job, run, project, suite}; el runner espera campos planos. Mantener
  // este mapeo acá evita tocar el handler que es consumido por tests.
  const { job, run, suite } = result.body;
  const flat = {
    job_id: job.id,
    run_id: run.id,
    project_id: run.project_id,
    suite_slug: suite.slug,
    target_base_url: run.target_base_url,
    target_env: run.target_env,
    mode: "read-only" as const,
    specs: suite.specs,
    // `job.created_at` es `string` según QaRunnerJob. Cubrimos el borde por
    // si algún repo entrega un Date (p.ej. driver que no castea a texto).
    created_at:
      typeof job.created_at === "string"
        ? job.created_at
        : (job.created_at as unknown as Date).toISOString(),
  };
  return NextResponse.json(flat, { status: result.status });
}
