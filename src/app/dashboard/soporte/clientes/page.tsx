"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Building2, Search } from "lucide-react";
import { apiSoporte, fecha, fechaHora } from "../_ui/api";
import { Aviso, Avatar, Cargando, Encabezado, Pagina, Tarjeta, Vacio, claseInput } from "../_ui/ui";

type FilaCliente = {
  cliente_id: string;
  cliente_nombre: string;
  abiertos: number;
  cerrados: number;
  urgentes: number;
  sla_vencidos: number;
  ultimo: { id: string; numero: number; asunto: string; created_at: string } | null;
  ultima_actividad: string | null;
};

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

/** Número en píldora de color; en cero se apaga para que resalte lo que hay. */
function Chip({ n, clase }: { n: number; clase: string }) {
  return (
    <span className={`inline-flex min-w-7 justify-center rounded-full px-2 py-0.5 text-[12px] font-bold tabular-nums ${n ? clase : "bg-slate-50 text-slate-300"}`}>
      {n}
    </span>
  );
}

/**
 * Soporte visto por cliente. No es otra tabla de clientes: son los clientes del
 * ERP que tienen tickets, con sus números. Clic en uno abre sus tickets.
 */
export default function SoporteClientesPage() {
  const router = useRouter();
  const [filas, setFilas] = useState<FilaCliente[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    apiSoporte<FilaCliente[]>("/api/soporte/clientes").then(setFilas).catch((e: Error) => setError(e.message));
  }, []);

  const visibles = useMemo(() => {
    const t = norm(q.trim());
    return (filas ?? []).filter((f) => !t || norm(f.cliente_nombre).includes(t));
  }, [filas, q]);

  const ir = (id: string) => router.push(`/dashboard/soporte/tickets?cliente_id=${id}`);

  return (
    <Pagina>
      <Encabezado titulo="Clientes" subtitulo="Estado del soporte por cliente" icono={Building2} tono="turquesa" />
      {error ? <Aviso>{error}</Aviso> : null}
      <Tarjeta padding="p-0">
        <div className="border-b border-slate-100 px-4 py-3">
          <label className="relative block max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input className={`${claseInput} pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente…" aria-label="Buscar cliente" />
          </label>
        </div>
        {filas == null ? (
          error ? null : <Cargando />
        ) : visibles.length === 0 ? (
          <Vacio icono={Building2} titulo={filas.length ? "Ningún cliente coincide" : "Todavía no hay clientes con tickets"} />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[860px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-slate-100 text-[11.5px] text-slate-500">
                    <th className="px-5 py-2.5 font-medium">Cliente</th>
                    <th className="px-3 py-2.5 text-right font-medium">Abiertos</th>
                    <th className="px-3 py-2.5 text-right font-medium">Cerrados</th>
                    <th className="px-3 py-2.5 text-right font-medium">Urgentes</th>
                    <th className="px-3 py-2.5 text-right font-medium">SLA vencidos</th>
                    <th className="px-3 py-2.5 font-medium">Último ticket</th>
                    <th className="px-5 py-2.5 text-right font-medium">Última actividad</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((f) => (
                    <tr key={f.cliente_id} onClick={() => ir(f.cliente_id)} className="group cursor-pointer border-b border-slate-100 last:border-0 hover:bg-[#4FAEB2]/[0.04]">
                      <td className="px-5 py-3">
                        <span className="flex items-center gap-2.5 font-semibold text-slate-800 group-hover:text-[#2F6E71]">
                          <Avatar nombre={f.cliente_nombre} tam={28} />
                          {f.cliente_nombre}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right"><Chip n={f.abiertos} clase="bg-sky-100 text-sky-700" /></td>
                      <td className="px-3 py-3 text-right"><Chip n={f.cerrados} clase="bg-emerald-100 text-emerald-700" /></td>
                      <td className="px-3 py-3 text-right"><Chip n={f.urgentes} clase="bg-amber-100 text-amber-700" /></td>
                      <td className="px-3 py-3 text-right"><Chip n={f.sla_vencidos} clase="bg-rose-100 text-rose-700" /></td>
                      <td className="max-w-[280px] px-3 py-3">
                        {f.ultimo ? (
                          <Link href={`/dashboard/soporte/tickets/${f.ultimo.id}`} onClick={(e) => e.stopPropagation()} className="block truncate text-slate-700 no-underline hover:text-[#2F6E71]">
                            <span className="tabular-nums text-slate-400">#{f.ultimo.numero}</span> {f.ultimo.asunto}
                          </Link>
                        ) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums text-slate-500">{fechaHora(f.ultima_actividad)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-slate-100 md:hidden">
              {visibles.map((f) => (
                <li key={f.cliente_id}>
                  <button type="button" onClick={() => ir(f.cliente_id)} className="block w-full px-4 py-3 text-left">
                    <p className="text-sm font-medium text-slate-900">{f.cliente_nombre}</p>
                    <p className="mt-1 text-[12px] text-slate-500">
                      {f.abiertos} abiertos · {f.cerrados} cerrados
                      {f.sla_vencidos ? <span className="text-rose-600"> · {f.sla_vencidos} SLA vencidos</span> : null}
                    </p>
                    <p className="text-[11.5px] text-slate-400">Última actividad {fecha(f.ultima_actividad)}</p>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Tarjeta>
    </Pagina>
  );
}
