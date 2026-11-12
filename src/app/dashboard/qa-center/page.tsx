/**
 * NEURA QA CENTER — panel principal.
 *
 * Autoriza vía `resolveQaAccess`: super_admin o miembro del equipo QA Neura
 * (empresa interna + módulo qa_center activo + asignación individual).
 * Toda la verificación con cookie-scoped client (RLS self-read), sin service_role.
 */

import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveQaAccess } from "@/lib/qa/authorize";
import { listQaProjects, listQaRuns } from "@/lib/qa/db";
import { buildQaRepo } from "@/lib/qa/route-helpers";
import type { QaFindingRow } from "@/lib/qa/repo-types";
import QaCenterPanel from "./_ui/QaCenterPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "QA Center" };

export default async function QaCenterPage() {
  const sb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user?.email) notFound();

  const decision = await resolveQaAccess(sb, user.email);
  if (!decision.ok) notFound();

  // 2) Lectura por PG directo (fail-closed si QA_DB_URL ausente).
  let projects: Awaited<ReturnType<typeof listQaProjects>>;
  let runs: Awaited<ReturnType<typeof listQaRuns>>;
  try {
    projects = await listQaProjects();
  } catch (err) {
    projects = {
      data: [],
      migration_status: "config_missing",
      note: err instanceof Error ? err.message : "Error inesperado leyendo proyectos.",
    };
  }
  try {
    runs = await listQaRuns({ limit: 10 });
  } catch (err) {
    runs = {
      data: [],
      migration_status: "config_missing",
      note: err instanceof Error ? err.message : "Error inesperado leyendo corridas.",
    };
  }

  // Findings — lectura directa del repo (fail-closed: si QA_DB_URL falta, lista vacía).
  let findings: QaFindingRow[] = [];
  try {
    const repo = buildQaRepo();
    if (repo) findings = await repo.listFindings({ limit: 200 });
  } catch {
    findings = [];
  }

  return <QaCenterPanel projects={projects} runs={runs} findings={findings} />;
}
