/**
 * QA Center · Historial — todos los runs agrupados por día, con proyecto,
 * estado, duración y barra de aprobación. Rediseño visual tipo CRM.
 */
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveQaAccess } from "@/lib/qa/authorize";
import { listQaProjects, listQaRuns } from "@/lib/qa/db";
import HistorialVista from "./HistorialVista";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "QA Center · Historial" };

export default async function QaHistorialPage() {
  const sb = await createSupabaseServerClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user?.email) notFound();
  const decision = await resolveQaAccess(sb, user.email);
  if (!decision.ok) notFound();

  const [runsResult, projectsResult] = await Promise.all([
    listQaRuns({ limit: 150 }).catch(() => ({ data: [], migration_status: "config_missing" as const })),
    listQaProjects(200).catch(() => ({ data: [], migration_status: "config_missing" as const })),
  ]);

  const byProjectId = new Map(projectsResult.data.map((p) => [p.id, p]));
  const enriched = runsResult.data.map((r) => {
    const proj = byProjectId.get(r.project_id) ?? null;
    return {
      id: r.id,
      status: r.status,
      duration_ms: r.duration_ms,
      totals: r.totals ?? {},
      created_at: r.created_at,
      project: proj
        ? { id: proj.id, name: proj.name, slug: proj.slug, tipo_proyecto: proj.tipo_proyecto }
        : null,
    };
  });

  return <HistorialVista runs={enriched} />;
}
