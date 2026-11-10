"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Users, Search, ChevronRight, ChevronDown, ChevronUp, X, Clock, AlertTriangle, Trophy, UserCheck, UserX,
} from "lucide-react";
import { apiPersonal, fechaCorta } from "./api";
import { Chip, Select } from "./compartido";
import type { FuncionarioResumen } from "@/lib/personal/types";

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
function iniciales(nombre: string): string {
  return nombre.trim().split(/\s+/).slice(0, 2).map((p) => p[0] ?? "").join("").toUpperCase() || "?";
}
function esActivo(f: FuncionarioResumen): boolean {
  return (f.estado ?? "").toLowerCase() === "activo";
}

const AREA_CHIPS = [
  "bg-sky-50 text-sky-700 ring-sky-200", "bg-violet-50 text-violet-700 ring-violet-200",
  "bg-amber-50 text-amber-700 ring-amber-200", "bg-emerald-50 text-emerald-700 ring-emerald-200",
  "bg-rose-50 text-rose-700 ring-rose-200", "bg-teal-50 text-teal-700 ring-teal-200",
  "bg-indigo-50 text-indigo-700 ring-indigo-200", "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200",
];
function areaChip(area: string | null): string {
  if (!area) return "bg-slate-100 text-slate-500 ring-slate-200";
  let h = 0;
  for (const ch of normalizar(area)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AREA_CHIPS[h % AREA_CHIPS.length];
}
function antiguedad(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (isNaN(d.getTime())) return "—";
  const meses = Math.max(0, (new Date().getFullYear() - d.getFullYear()) * 12 + (new Date().getMonth() - d.getMonth()));
  const a = Math.floor(meses / 12), m = meses % 12;
  if (a <= 0) return `${m} m`;
  return m ? `${a} a ${m} m` : `${a} a`;
}

function Avatar({ nombre, activo }: { nombre: string; activo: boolean }) {
  return (
    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12.5px] font-bold text-white ${activo ? "bg-gradient-to-br from-[#4FAEB2] to-[#2F8E92]" : "bg-slate-300"}`}>
      {iniciales(nombre)}
    </span>
  );
}

function PillStat({ icon: Icon, valor, label, color }: { icon: typeof Users; valor: number; label: string; color: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 shadow-sm">
      <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}><Icon className="h-4 w-4" aria-hidden /></span>
      <div><p className="text-lg font-bold leading-none text-slate-900">{valor}</p><p className="text-[11px] text-slate-400">{label}</p></div>
    </div>
  );
}

function MiniKpi({ icon: Icon, n, color }: { icon: typeof Clock; n: number; color: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${n > 0 ? color : "text-slate-300"}`} title={String(n)}>
      <Icon className="h-3.5 w-3.5" aria-hidden /><span className="text-[12.5px] font-semibold tabular-nums">{n}</span>
    </span>
  );
}

type SortKey = "nombre" | "area" | "ingreso" | "estado" | "actividad";
type SortState = { key: SortKey; dir: "asc" | "desc" };

function ThSort({ k, children, className, sort, onSort }: { k: SortKey; children: React.ReactNode; className?: string; sort: SortState; onSort: (k: SortKey) => void }) {
  return (
    <th className={`py-2.5 pr-3 ${className ?? ""}`}>
      <button type="button" onClick={() => onSort(k)} className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 transition hover:text-slate-600">
        {children}
        {sort.key === k ? (sort.dir === "asc" ? <ChevronUp className="h-3 w-3" aria-hidden /> : <ChevronDown className="h-3 w-3" aria-hidden />) : null}
      </button>
    </th>
  );
}

export default function PersonalListClient() {
  const router = useRouter();
  const [lista, setLista] = useState<FuncionarioResumen[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("todos");
  const [area, setArea] = useState("todas");
  const [sort, setSort] = useState<SortState>({ key: "nombre", dir: "asc" });

  useEffect(() => {
    apiPersonal<{ funcionarios: FuncionarioResumen[] }>("/api/personal")
      .then((d) => setLista(d.funcionarios))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar"));
  }, []);

  const areas = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of lista ?? []) { const a = (f.area ?? "").trim(); if (a) m.set(a, (m.get(a) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [lista]);

  const filtrada = useMemo(() => {
    if (!lista) return [];
    const t = normalizar(q.trim());
    const terminos = t ? t.split(/\s+/) : [];
    const out = lista.filter((f) => {
      if (estado === "activos" && !esActivo(f)) return false;
      if (estado === "inactivos" && esActivo(f)) return false;
      if (area !== "todas" && normalizar(f.area ?? "") !== normalizar(area)) return false;
      if (!terminos.length) return true;
      const campo = normalizar([f.nombre, f.cargo, f.area, f.codigo_empleado].filter(Boolean).join(" "));
      return terminos.every((term) => campo.includes(term));
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    const act = (f: FuncionarioResumen) => f.kpis.llegadas_tardias + f.kpis.incidencias + f.kpis.reconocimientos;
    out.sort((a, b) => {
      let c = 0;
      if (sort.key === "nombre") c = a.nombre.localeCompare(b.nombre, "es");
      else if (sort.key === "area") c = (a.area ?? "").localeCompare(b.area ?? "", "es");
      else if (sort.key === "estado") c = Number(esActivo(b)) - Number(esActivo(a));
      else if (sort.key === "ingreso") c = (a.fecha_ingreso ?? "").localeCompare(b.fecha_ingreso ?? "");
      else if (sort.key === "actividad") c = act(a) - act(b);
      return c * dir;
    });
    return out;
  }, [lista, q, estado, area, sort]);

  const totalActivos = useMemo(() => (lista ?? []).filter(esActivo).length, [lista]);
  const hayFiltro = q.trim() !== "" || estado !== "todos" || area !== "todas";
  const limpiar = () => { setQ(""); setEstado("todos"); setArea("todas"); };

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#4FAEB2]/10 text-[#2F8E92]"><Users className="h-6 w-6" aria-hidden /></span>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Gestión de Personal</h1>
            <p className="text-sm text-slate-500">Hoja de vida, asistencia e incidencias del equipo.</p>
          </div>
        </div>
        {lista ? (
          <div className="flex items-center gap-2">
            <PillStat icon={Users} valor={lista.length} label="Funcionarios" color="bg-[#4FAEB2]/10 text-[#2F8E92]" />
            <PillStat icon={UserCheck} valor={totalActivos} label="Activos" color="bg-emerald-50 text-emerald-600" />
            <PillStat icon={UserX} valor={lista.length - totalActivos} label="Inactivos" color="bg-slate-100 text-slate-500" />
          </div>
        ) : null}
      </header>

      {/* Toolbar: buscador + selectores */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nombre, cargo, área o código…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-8 text-sm text-slate-800 shadow-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
          />
          {q ? (
            <button type="button" onClick={() => setQ("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Limpiar"><X className="h-3.5 w-3.5" aria-hidden /></button>
          ) : null}
        </div>
        <Select value={estado} onChange={setEstado} className="w-40" options={[
          { value: "todos", label: "Todos los estados" }, { value: "activos", label: "Solo activos" }, { value: "inactivos", label: "Solo inactivos" },
        ]} />
        <Select value={area} onChange={setArea} className="w-44" options={[
          { value: "todas", label: "Todas las áreas" }, ...areas.map(([a, n]) => ({ value: a, label: `${a} (${n})` })),
        ]} />
        {hayFiltro ? <button type="button" onClick={limpiar} className="rounded-lg px-2.5 py-2 text-[13px] font-semibold text-slate-500 hover:bg-slate-100">Limpiar</button> : null}
      </div>

      {/* Chips de área (filtro rápido + aprovecha el ancho) */}
      {areas.length ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setArea("todas")} className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ring-1 ring-inset transition ${area === "todas" ? "bg-[#4FAEB2] text-white ring-[#4FAEB2]" : "bg-white text-slate-500 ring-slate-200 hover:bg-slate-50"}`}>
            Todas · {lista?.length ?? 0}
          </button>
          {areas.map(([a, n]) => (
            <button key={a} type="button" onClick={() => setArea(area === a ? "todas" : a)}
              className={`rounded-full px-2.5 py-1 text-[12px] font-semibold capitalize ring-1 ring-inset transition ${area === a ? "bg-[#4FAEB2] text-white ring-[#4FAEB2]" : `${areaChip(a)} hover:brightness-95`}`}>
              {a} · {n}
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : lista == null ? (
        <div className="py-20 text-center text-sm text-slate-400">Cargando…</div>
      ) : (
        <>
          <p className="mb-2 text-[12.5px] text-slate-400">{filtrada.length} de {lista.length} {lista.length === 1 ? "funcionario" : "funcionarios"}{hayFiltro ? " (filtrado)" : ""}</p>
          {filtrada.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 py-16 text-center text-sm text-slate-400">Sin resultados para el filtro.</div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-left text-[13.5px]">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/70">
                      <ThSort k="nombre" className="pl-4" sort={sort} onSort={toggleSort}>Funcionario</ThSort>
                      <th className="py-2.5 pr-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Cargo</th>
                      <ThSort k="area" sort={sort} onSort={toggleSort}>Área</ThSort>
                      <ThSort k="ingreso" sort={sort} onSort={toggleSort}>Antigüedad</ThSort>
                      <ThSort k="estado" sort={sort} onSort={toggleSort}>Estado</ThSort>
                      <ThSort k="actividad" sort={sort} onSort={toggleSort}>Actividad</ThSort>
                      <th className="py-2.5 pr-4"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtrada.map((f) => {
                      const activo = esActivo(f);
                      return (
                        <tr key={f.id} onClick={() => router.push(`/personal/${f.id}`)} className="group cursor-pointer border-b border-slate-50 transition last:border-0 hover:bg-[#4FAEB2]/[0.04]">
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
                          <td className="py-2.5 pr-3">{f.area ? <Chip className={`capitalize ${areaChip(f.area)}`}>{f.area}</Chip> : <span className="text-slate-300">—</span>}</td>
                          <td className="py-2.5 pr-3">
                            {f.fecha_ingreso ? (
                              <span className="text-slate-600" title={fechaCorta(f.fecha_ingreso)}>{antiguedad(f.fecha_ingreso)}</span>
                            ) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="py-2.5 pr-3"><Chip className={activo ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-100 text-slate-500 ring-slate-200"}>{f.estado ?? "—"}</Chip></td>
                          <td className="py-2.5 pr-3">
                            <div className="flex items-center gap-3">
                              <MiniKpi icon={Clock} n={f.kpis.llegadas_tardias} color="text-amber-600" />
                              <MiniKpi icon={AlertTriangle} n={f.kpis.incidencias} color="text-rose-600" />
                              <MiniKpi icon={Trophy} n={f.kpis.reconocimientos} color="text-emerald-600" />
                            </div>
                          </td>
                          <td className="py-2.5 pr-4 text-right"><ChevronRight className="inline h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[#2F8E92]" aria-hidden /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
