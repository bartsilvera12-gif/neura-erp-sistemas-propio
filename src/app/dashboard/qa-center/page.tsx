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
import QaCenterPanel, { type AiEstadoProyecto } from "./_ui/QaCenterPanel";
import { codebaseDeProyecto } from "@/lib/qa/pruebas-catalogo";

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
  const aiEstado: Record<string, AiEstadoProyecto> = {};
  try {
    const repo = buildQaRepo();
    if (repo) {
      findings = await repo.listFindings({ limit: 200 });

      // Hidratar estado IA por proyecto: cobertura, último discovery, último informe, costo.
      for (const p of projects.data ?? []) {
        const codebase = codebaseDeProyecto({ slug: p.slug });
        try {
          const cob = codebase !== "otro"
            ? await repo.coberturaPorModuloParaCodebase(codebase)
            : [];
          const disc = await repo.latestErpDiscovery(p.id);
          const inf = await repo.latestInformeIa(p.id);
          let cost = 0;
          if (disc?.run_id) cost = await repo.sumAiCostForRun(disc.run_id);
          aiEstado[p.id] = {
            projectId: p.id,
            totalCostUsd: cost,
            cobertura: cob,
            lastDiscovery: disc
              ? {
                  created_at: disc.created_at,
                  modulos: Array.isArray(disc.modulos)
                    ? (disc.modulos as Array<{ nombre: string; totalRutas?: number }>)
                    : null,
                  totales:
                    disc.totales && typeof disc.totales === "object"
                      ? (disc.totales as Record<string, number>)
                      : null,
                }
              : null,
            lastInforme: inf
              ? {
                  resumen: inf.resumen,
                  modulos: Array.isArray(inf.modulos)
                    ? (inf.modulos as NonNullable<AiEstadoProyecto["lastInforme"]>["modulos"])
                    : [],
                  parcial: false,
                  created_at: inf.created_at,
                }
              : null,
          };
        } catch {
          // Si la hidratación IA falla (p.ej. migración 2026-11-13-27 no aplicada aún),
          // seguimos con el resto del panel.
        }
      }
    }
  } catch {
    findings = [];
  }

  return (
    <QaCenterPanel
      projects={projects}
      runs={runs}
      findings={findings}
      aiEstado={aiEstado}
      anthropicConfigured={null}
      credencialesRoRunnerConfigured={null}
    />
  );
}
