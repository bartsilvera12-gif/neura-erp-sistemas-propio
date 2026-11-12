/**
 * NEURA QA CENTER — panel principal.
 *
 * Lectura de datos EXCLUSIVAMENTE vía Postgres directo (`listQaProjects`,
 * `listQaRuns` que usan `PostgresQaRunsRepo` + `QA_DB_URL`). No se instancia
 * service_role en ningún lugar del flujo.
 *
 * Super_admin check: `neura.usuarios.rol = 'super_admin'` leído por el
 * propio usuario vía cookie-scoped client (RLS self-read). No hay fallback
 * por email: si la DB no responde, 404 opaco (fail-closed).
 */

import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listQaProjects, listQaRuns } from "@/lib/qa/db";
import QaCenterPanel from "./_ui/QaCenterPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "QA Center" };

export default async function QaCenterPage() {
  // 1) Autenticación por cookie (cliente user-scoped, sin service_role).
  const sb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user?.email) {
    notFound();
  }
  // Rol en DB vía RLS self-read. Fail-closed: si la DB no responde → notFound().
  let rolFromDb: string | null = null;
  try {
    const { data, error } = await sb
      .from("usuarios")
      .select("rol")
      .eq("email", user.email)
      .limit(1);
    if (error) notFound();
    rolFromDb = (data?.[0] as { rol?: string | null } | undefined)?.rol ?? null;
  } catch {
    notFound();
  }
  if (rolFromDb !== "super_admin") notFound();

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

  return <QaCenterPanel projects={projects} runs={runs} />;
}
