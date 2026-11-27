/**
 * QA Center · Entregados — ERPs que ya pasaron QA y fueron entregados al
 * cliente. Vista tipo CRM con header, chips de stats y cards con color.
 */
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveQaAccess } from "@/lib/qa/authorize";
import { listQaProjects } from "@/lib/qa/db";
import EntregadosVista from "./EntregadosVista";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "QA Center · Entregados" };

export default async function QaEntregadosPage() {
  const sb = await createSupabaseServerClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user?.email) notFound();
  const decision = await resolveQaAccess(sb, user.email);
  if (!decision.ok) notFound();

  let proyectos: Awaited<ReturnType<typeof listQaProjects>>;
  try { proyectos = await listQaProjects(200); }
  catch { proyectos = { data: [], migration_status: "config_missing" }; }

  const entregados = proyectos.data
    .filter((p) => p.estado_entrega === "entregado")
    .map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      repo_url: p.repo_url,
      target_base_url: p.target_base_url,
      tipo_proyecto: p.tipo_proyecto,
      autorizacion_qa_hasta: p.autorizacion_qa_hasta,
    }));

  return <EntregadosVista entregados={entregados} />;
}
