/**
 * NEURA QA CENTER — panel principal.
 *
 * Pensado para QA Desarrollo. Entra solo super_admin (gating server-side).
 * Esta página no muta nada: solo lee `qa_center.projects` y `qa_center.runs`
 * usando service-role vía endpoints `/api/qa/*`. Si la migración todavía no
 * corrió, se muestra un estado vacío honesto que indica el próximo paso.
 *
 * Aditivo: no modifica rutas, APIs, módulos ni componentes preexistentes.
 */

import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/super-admin-bootstrap-email";
import { listQaProjects, listQaRuns } from "@/lib/qa/db";
import { createClient } from "@supabase/supabase-js";
import { supabaseServiceRoleClientOptions } from "@/lib/supabase/schema";
import QaCenterPanel from "./_ui/QaCenterPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "QA Center" };

export default async function QaCenterPage() {
  // 1) Gating server-side. Si no es super_admin, 404 opaco (como /panel-control).
  const sb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user?.email) notFound();

  const { data: usuarioRow } = await sb
    .from("usuarios")
    .select("rol")
    .eq("email", user.email)
    .limit(1);
  const rol = (usuarioRow?.[0] as { rol?: string | null } | undefined)?.rol ?? "";
  const esSuperAdmin = rol === "super_admin" || isBootstrapSuperAdminEmail(user.email);
  if (!esSuperAdmin) notFound();

  // 2) Lectura con service-role, scoped al esquema qa_center.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let projects: Awaited<ReturnType<typeof listQaProjects>> = {
    data: [],
    migration_status: "schema_not_exposed",
    note: "Config Supabase no disponible en el servidor.",
  };
  let runs: Awaited<ReturnType<typeof listQaRuns>> = {
    data: [],
    migration_status: "schema_not_exposed",
    note: "Config Supabase no disponible en el servidor.",
  };

  if (url && key) {
    const serviceClient = createClient(url, key, {
      ...supabaseServiceRoleClientOptions,
    });
    try {
      projects = await listQaProjects(serviceClient);
    } catch (err) {
      projects = {
        data: [],
        migration_status: "schema_not_exposed",
        note: err instanceof Error ? err.message : "Error inesperado",
      };
    }
    try {
      runs = await listQaRuns(serviceClient, { limit: 10 });
    } catch (err) {
      runs = {
        data: [],
        migration_status: "schema_not_exposed",
        note: err instanceof Error ? err.message : "Error inesperado",
      };
    }
  }

  return <QaCenterPanel projects={projects} runs={runs} />;
}
