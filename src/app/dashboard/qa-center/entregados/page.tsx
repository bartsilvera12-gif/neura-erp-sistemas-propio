/**
 * QA Center · Entregados — lista los ERPs que ya pasaron QA y fueron
 * marcados como entregados al cliente.
 *
 * Fuente: qa_center.projects con estado_entrega='entregado'.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveQaAccess } from "@/lib/qa/authorize";
import { listQaProjects } from "@/lib/qa/db";

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

  const entregados = proyectos.data.filter((p) => p.estado_entrega === "entregado");

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-slate-900">ERPs entregados</h1>
        <p className="mt-1 text-sm text-slate-600">
          {entregados.length === 0
            ? "Todavía no hay ERPs marcados como entregados."
            : `${entregados.length} ERP(s) ya entregados al cliente después de pasar QA.`}
        </p>
      </header>

      {entregados.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-10 text-center">
          <p className="text-sm text-slate-600">
            Cuando un ERP pase QA y lo marques como entregado, aparece acá.
          </p>
          <Link
            href="/dashboard/qa-center"
            className="mt-3 inline-block rounded-lg bg-[#0EA5E9] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0284C7]"
          >
            Ver proyectos
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white" data-testid="entregados-tabla">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">ERP</th>
                <th className="hidden px-4 py-2 text-left font-semibold md:table-cell">Repositorio</th>
                <th className="hidden px-4 py-2 text-left font-semibold md:table-cell">URL probada</th>
                <th className="px-4 py-2 text-left font-semibold">Tipo</th>
                <th className="px-4 py-2 text-right font-semibold">Entregado</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entregados.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <div className="font-medium text-slate-900">{p.name}</div>
                    <div className="font-mono text-[11px] text-slate-500">{p.slug}</div>
                  </td>
                  <td className="hidden max-w-xs truncate px-4 py-2 text-xs text-slate-600 md:table-cell">
                    {p.repo_url ? (
                      <a
                        href={p.repo_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#0EA5E9] hover:underline"
                      >
                        {p.repo_url.replace(/^https?:\/\/(www\.)?/, "")}
                      </a>
                    ) : "—"}
                  </td>
                  <td className="hidden max-w-xs truncate px-4 py-2 text-xs text-slate-600 md:table-cell">
                    {p.target_base_url || "—"}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${
                      p.tipo_proyecto === "web"
                        ? "bg-violet-100 text-violet-700 ring-violet-200"
                        : "bg-sky-100 text-sky-700 ring-sky-200"
                    }`}>
                      {p.tipo_proyecto === "web" ? "Web" : "ERP"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right text-xs text-slate-600">
                    {p.autorizacion_qa_hasta
                      ? new Date(p.autorizacion_qa_hasta).toLocaleDateString("es-PY", { day: "2-digit", month: "short", year: "numeric" })
                      : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/dashboard/qa-center#proyecto-${p.id}`}
                      className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                    >
                      Ver
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
