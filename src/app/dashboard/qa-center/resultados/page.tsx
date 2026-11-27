/**
 * QA Center · Resultados — últimos runs con estado, duración, proyecto
 * y barra de aprobación. Rediseño visual tipo CRM: cards con color de
 * acento por estado + info del proyecto (nombre, slug, tipo, repo).
 */
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveQaAccess } from "@/lib/qa/authorize";
import { listQaProjects, listQaRuns } from "@/lib/qa/db";
import ResultadosVista from "./ResultadosVista";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "QA Center · Resultados" };

export default async function QaResultadosPage() {
  const sb = await createSupabaseServerClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user?.email) notFound();
  const decision = await resolveQaAccess(sb, user.email);
  if (!decision.ok) notFound();

  const [runsResult, projectsResult] = await Promise.all([
    listQaRuns({ limit: 30 }).catch(() => ({ data: [], migration_status: "config_missing" as const })),
    listQaProjects(200).catch(() => ({ data: [], migration_status: "config_missing" as const })),
  ]);

  // Mapa id → proyecto. El runs row sólo trae project_id.
  const byProjectId = new Map(projectsResult.data.map((p) => [p.id, p]));
  const enriched = runsResult.data.map((r) => {
    const proj = byProjectId.get(r.project_id) ?? null;
    return {
      id: r.id,
      status: r.status,
      duration_ms: r.duration_ms,
      totals: r.totals ?? {},
      created_at: r.created_at,
      target_base_url: r.target_base_url,
      project: proj
        ? {
            id: proj.id,
            name: proj.name,
            slug: proj.slug,
            repo_url: proj.repo_url,
            tipo_proyecto: proj.tipo_proyecto,
          }
        : null,
    };
  });

  return <ResultadosVista runs={enriched} />;
}
