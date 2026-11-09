"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Users, Search, ChevronRight } from "lucide-react";
import { apiPersonal } from "./api";
import { Chip, Select } from "./compartido";
import type { FuncionarioResumen } from "@/lib/personal/types";

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function iniciales(nombre: string): string {
  return nombre.trim().split(/\s+/).slice(0, 2).map((p) => p[0] ?? "").join("").toUpperCase() || "?";
}

function Avatar({ nombre, activo }: { nombre: string; activo: boolean }) {
  return (
    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12.5px] font-bold text-white ${activo ? "bg-gradient-to-br from-[#4FAEB2] to-[#2F8E92]" : "bg-slate-300"}`}>
      {iniciales(nombre)}
    </span>
  );
}

function KpiNum({ n, color }: { n: number; color: string }) {
  return <span className={`inline-flex min-w-6 justify-center text-[13px] font-semibold ${n > 0 ? color : "text-slate-300"}`}>{n}</span>;
}

export default function PersonalListClient() {
  const router = useRouter();
  const [lista, setLista] = useState<FuncionarioResumen[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("todos");

  useEffect(() => {
    apiPersonal<{ funcionarios: FuncionarioResumen[] }>("/api/personal")
      .then((d) => setLista(d.funcionarios))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar"));
  }, []);

  const filtrada = useMemo(() => {
    if (!lista) return [];
    const t = normalizar(q.trim());
    const terminos = t ? t.split(/\s+/) : [];
    return lista.filter((f) => {
      const esActivo = (f.estado ?? "").toLowerCase() === "activo";
      if (estado === "activos" && !esActivo) return false;
      if (estado === "inactivos" && esActivo) return false;
      if (!terminos.length) return true;
      const campo = normalizar([f.nombre, f.cargo, f.area, f.codigo_empleado].filter(Boolean).join(" "));
      return terminos.every((term) => campo.includes(term));
    });
  }, [lista, q, estado]);

  const totalActivos = useMemo(() => (lista ?? []).filter((f) => (f.estado ?? "").toLowerCase() === "activo").length, [lista]);

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#4FAEB2]/10 text-[#2F8E92]">
            <Users className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Gestión de Personal</h1>
            <p className="text-sm text-slate-500">Hoja de vida, asistencia e incidencias del equipo.</p>
          </div>
        </div>
        {lista ? (
          <div className="flex items-center gap-4 text-[13px]">
            <div className="text-right"><p className="text-lg font-bold leading-none text-slate-900">{lista.length}</p><p className="text-[11px] text-slate-400">Funcionarios</p></div>
            <div className="h-8 w-px bg-slate-200" />
            <div className="text-right"><p className="text-lg font-bold leading-none text-emerald-600">{totalActivos}</p><p className="text-[11px] text-slate-400">Activos</p></div>
          </div>
        ) : null}
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nombre, cargo, área o código…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-800 shadow-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
          />
        </div>
        <Select
          value={estado}
          onChange={setEstado}
          className="w-40"
          options={[
            { value: "todos", label: "Todos los estados" },
            { value: "activos", label: "Solo activos" },
            { value: "inactivos", label: "Solo inactivos" },
          ]}
        />
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : lista == null ? (
        <div className="py-20 text-center text-sm text-slate-400">Cargando…</div>
      ) : filtrada.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 py-16 text-center text-sm text-slate-400">
          {q || estado !== "todos" ? "Sin resultados para el filtro." : "No hay funcionarios cargados."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <th className="py-2.5 pl-4 pr-3">Funcionario</th>
                  <th className="py-2.5 pr-3">Cargo</th>
                  <th className="py-2.5 pr-3">Área</th>
                  <th className="py-2.5 pr-3">Estado</th>
                  <th className="py-2.5 pr-3 text-center">Tardías</th>
                  <th className="py-2.5 pr-3 text-center">Incid.</th>
                  <th className="py-2.5 pr-3 text-center">Recon.</th>
                  <th className="py-2.5 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {filtrada.map((f) => {
                  const activo = (f.estado ?? "").toLowerCase() === "activo";
                  return (
                    <tr
                      key={f.id}
                      onClick={() => router.push(`/personal/${f.id}`)}
                      className="group cursor-pointer border-b border-slate-50 transition last:border-0 hover:bg-[#4FAEB2]/[0.04]"
                    >
                      <td className="py-2.5 pl-4 pr-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar nombre={f.nombre} activo={activo} />
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-slate-800 group-hover:text-[#2F8E92]">{f.nombre}</p>
                            {f.codigo_empleado ? <p className="text-[11.5px] text-slate-400">Código {f.codigo_empleado}</p> : null}
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 pr-3 text-slate-600">{f.cargo || <span className="text-slate-300">—</span>}</td>
                      <td className="py-2.5 pr-3 text-slate-600">{f.area || <span className="text-slate-300">—</span>}</td>
                      <td className="py-2.5 pr-3">
                        <Chip className={activo ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-100 text-slate-500 ring-slate-200"}>{f.estado ?? "—"}</Chip>
                      </td>
                      <td className="py-2.5 pr-3 text-center"><KpiNum n={f.kpis.llegadas_tardias} color="text-amber-600" /></td>
                      <td className="py-2.5 pr-3 text-center"><KpiNum n={f.kpis.incidencias} color="text-rose-600" /></td>
                      <td className="py-2.5 pr-3 text-center"><KpiNum n={f.kpis.reconocimientos} color="text-emerald-600" /></td>
                      <td className="py-2.5 pr-4 text-right">
                        <ChevronRight className="inline h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[#2F8E92]" aria-hidden />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
