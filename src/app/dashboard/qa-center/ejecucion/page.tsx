/**
 * QA Center · Ejecución — vista enfocada en disparar runs.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveQaAccess } from "@/lib/qa/authorize";
import { listQaProjects } from "@/lib/qa/db";
import BotonEjecutarRapido from "../_ui/BotonEjecutarRapido";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "QA Center · Ejecución" };

export default async function QaEjecucionPage() {
  const sb = await createSupabaseServerClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user?.email) notFound();
  const decision = await resolveQaAccess(sb, user.email);
  if (!decision.ok) notFound();

  let projects: Awaited<ReturnType<typeof listQaProjects>>;
  try { projects = await listQaProjects(); }
  catch { projects = { data: [], migration_status: "config_missing" }; }

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-slate-900">Ejecución</h1>
        <p className="mt-1 text-sm text-slate-600">
          Elegí un proyecto y dispará una corrida del agente QA. El runner
          levanta un sandbox temporal; nunca escribe en producción.
        </p>
      </header>

      {projects.data.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-8 text-center">
          <p className="text-sm text-slate-600">No hay proyectos cargados todavía.</p>
          <Link
            href="/dashboard/qa-center"
            className="mt-3 inline-block rounded-lg bg-[#0EA5E9] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0284C7]"
          >
            Crear proyecto
          </Link>
        </div>
      ) : (
        <ul className="space-y-3" data-testid="ejecucion-proyectos">
          {projects.data.map((p) => (
            <li
              key={p.id}
              className="group flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 transition-all hover:border-[#7DCFD2]/60 hover:shadow-md"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#0B3A3D] to-[#285C62] text-white">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="6 3 20 12 6 21 6 3" fill="currentColor" fillOpacity="0.2"/>
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900">{p.name}</p>
                <p className="truncate text-xs text-slate-500">
                  <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px]">{p.slug}</code>
                  {" · "}
                  {p.target_base_url || <span className="italic text-slate-400">sin URL publicada</span>}
                </p>
              </div>
              <BotonEjecutarRapido projectId={p.id} projectSlug={p.slug} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
