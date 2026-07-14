"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Plus, Power, Trash2, Upload } from "lucide-react";
import { GlobalConfigSubpageShell } from "@/components/config/GlobalConfigSubpageShell";
import { ConfigMetricCard } from "@/components/config/global-config-primitives";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import { PlanCuentaFormModal } from "./PlanCuentaFormModal";
import { PlanCuentasImportModal } from "./PlanCuentasImportModal";
import type { PlanCuentaItem, PlanCuentasResponse, PlanCuentasSummary } from "./types";

type FiltroAsentable = "todos" | "asentable" | "agrupadora";
type FiltroEstado = "todos" | "activas" | "inactivas";

const EMPTY_SUMMARY: PlanCuentasSummary = { total: 0, asentables: 0, agrupadoras: 0, activas: 0, inactivas: 0 };

export default function PlanDeCuentasPage() {
  const [cuentas, setCuentas] = useState<PlanCuentaItem[]>([]);
  const [summary, setSummary] = useState<PlanCuentasSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [fNivel, setFNivel] = useState<string>("");
  const [fNaturaleza, setFNaturaleza] = useState<string>("");
  const [fAsentable, setFAsentable] = useState<FiltroAsentable>("todos");
  const [fCentroCosto, setFCentroCosto] = useState<string>("");
  const [fMoneda, setFMoneda] = useState<string>("");
  const [fEstado, setFEstado] = useState<FiltroEstado>("todos");

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PlanCuentaItem | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await apiFetch("/api/configuracion/plan-cuentas");
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setLoadError(j?.error ?? `Error ${r.status}`);
        return;
      }
      const data = j.data as PlanCuentasResponse;
      setCuentas(data.cuentas);
      setSummary(data.summary);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // --- Estructura de árbol ---
  const { childrenByParent, roots, byId } = useMemo(() => {
    const byId = new Map(cuentas.map((c) => [c.id, c]));
    const childrenByParent = new Map<string | null, PlanCuentaItem[]>();
    for (const c of cuentas) {
      const key = c.cuenta_padre_id && byId.has(c.cuenta_padre_id) ? c.cuenta_padre_id : null;
      const arr = childrenByParent.get(key) ?? [];
      arr.push(c);
      childrenByParent.set(key, arr);
    }
    for (const arr of childrenByParent.values()) arr.sort((a, b) => a.cuenta.localeCompare(b.cuenta, "es"));
    const roots = childrenByParent.get(null) ?? [];
    return { childrenByParent, roots, byId };
  }, [cuentas]);

  const monedasDisponibles = useMemo(
    () => Array.from(new Set(cuentas.map((c) => c.moneda).filter(Boolean) as string[])).sort(),
    [cuentas]
  );
  const nivelesDisponibles = useMemo(
    () => Array.from(new Set(cuentas.map((c) => c.nivel))).sort((a, b) => a - b),
    [cuentas]
  );

  const hayFiltro =
    search.trim() !== "" ||
    fNivel !== "" ||
    fNaturaleza !== "" ||
    fAsentable !== "todos" ||
    fCentroCosto !== "" ||
    fMoneda !== "" ||
    fEstado !== "todos";

  const matchesFilter = useCallback(
    (c: PlanCuentaItem): boolean => {
      const q = search.trim().toLowerCase();
      if (q) {
        const hit =
          c.cuenta.toLowerCase().includes(q) ||
          c.denominacion.toLowerCase().includes(q) ||
          (c.cuenta_sset ?? "").toLowerCase().includes(q);
        if (!hit) return false;
      }
      if (fNivel !== "" && c.nivel !== Number(fNivel)) return false;
      if (fNaturaleza !== "" && c.naturaleza !== fNaturaleza) return false;
      if (fAsentable === "asentable" && !c.asentable) return false;
      if (fAsentable === "agrupadora" && c.asentable) return false;
      if (fCentroCosto === "si" && !c.centro_costo) return false;
      if (fCentroCosto === "no" && c.centro_costo) return false;
      if (fMoneda !== "" && (c.moneda ?? "") !== fMoneda) return false;
      if (fEstado === "activas" && !c.activo) return false;
      if (fEstado === "inactivas" && c.activo) return false;
      return true;
    },
    [search, fNivel, fNaturaleza, fAsentable, fCentroCosto, fMoneda, fEstado]
  );

  // Ids visibles cuando hay filtro: coincidencias + sus ancestros.
  const visibleIds = useMemo(() => {
    if (!hayFiltro) return null;
    const vis = new Set<string>();
    for (const c of cuentas) {
      if (matchesFilter(c)) {
        vis.add(c.id);
        let p = c.cuenta_padre_id;
        while (p && byId.has(p) && !vis.has(p)) {
          vis.add(p);
          p = byId.get(p)!.cuenta_padre_id;
        }
      }
    }
    return vis;
  }, [hayFiltro, cuentas, matchesFilter, byId]);

  // Filas planas a renderizar, en orden de árbol, con profundidad.
  const flatRows = useMemo(() => {
    const out: { c: PlanCuentaItem; depth: number; hasChildren: boolean }[] = [];
    const walk = (node: PlanCuentaItem, depth: number) => {
      const kids = childrenByParent.get(node.id) ?? [];
      const visibleKids = visibleIds ? kids.filter((k) => visibleIds.has(k.id)) : kids;
      const hasChildren = visibleKids.length > 0;
      out.push({ c: node, depth, hasChildren });
      const isOpen = visibleIds ? true : expanded.has(node.id);
      if (hasChildren && isOpen) {
        for (const k of visibleKids) walk(k, depth + 1);
      }
    };
    const visibleRoots = visibleIds ? roots.filter((r) => visibleIds.has(r.id)) : roots;
    for (const r of visibleRoots) walk(r, 0);
    return out;
  }, [roots, childrenByParent, expanded, visibleIds]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const expandAll = () => setExpanded(new Set(cuentas.filter((c) => c.tiene_hijos).map((c) => c.id)));
  const collapseAll = () => setExpanded(new Set());

  // --- Acciones ---
  async function toggleActivo(c: PlanCuentaItem) {
    setActionError(null);
    try {
      const r = await apiFetch(`/api/configuracion/plan-cuentas/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: !c.activo }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setActionError(j?.error ?? `Error ${r.status}`);
        return;
      }
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Error de red");
    }
  }

  async function eliminar(c: PlanCuentaItem) {
    setActionError(null);
    if (!window.confirm(`¿Eliminar la cuenta ${c.cuenta} — ${c.denominacion}? Esta acción no se puede deshacer.`)) return;
    try {
      const r = await apiFetch(`/api/configuracion/plan-cuentas/${c.id}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setActionError(j?.error ?? `Error ${r.status}`);
        return;
      }
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Error de red");
    }
  }

  const openNueva = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEditar = (c: PlanCuentaItem) => {
    setEditing(c);
    setFormOpen(true);
  };

  return (
    <GlobalConfigSubpageShell
      title="Plan de Cuentas"
      description="Administración de cuentas contables, niveles, naturaleza y configuración fiscal."
    >
      {/* Indicadores */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <ConfigMetricCard label="Total de cuentas" value={summary.total} />
        <ConfigMetricCard label="Asentables" value={summary.asentables} sub="Imputables" />
        <ConfigMetricCard label="Agrupadoras" value={summary.agrupadoras} sub="No asentables" />
        <ConfigMetricCard label="Activas" value={summary.activas} />
        <ConfigMetricCard label="Inactivas" value={summary.inactivas} />
      </div>

      {/* Barra de acciones */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={openNueva}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#4FAEB2] px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#3F8E91]"
        >
          <Plus className="h-4 w-4" /> Nueva cuenta
        </button>
        <button
          onClick={() => setImportOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:border-[#4FAEB2]/60 hover:bg-[#4FAEB2]/5"
        >
          <Upload className="h-4 w-4" /> Importar plan de cuentas
        </button>
        <button
          onClick={expandAll}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          <ChevronDown className="h-4 w-4" /> Expandir todo
        </button>
        <button
          onClick={collapseAll}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          <ChevronRight className="h-4 w-4" /> Contraer todo
        </button>
      </div>

      {/* Búsqueda + filtros */}
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por código, denominación o Cuenta SSET…"
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]"
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <select value={fNivel} onChange={(e) => setFNivel(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
            <option value="">Nivel: todos</option>
            {nivelesDisponibles.map((n) => (
              <option key={n} value={n}>
                Nivel {n}
              </option>
            ))}
          </select>
          <select value={fNaturaleza} onChange={(e) => setFNaturaleza(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
            <option value="">Naturaleza: todas</option>
            <option value="D">Deudora (D)</option>
            <option value="A">Acreedora (A)</option>
          </select>
          <select value={fAsentable} onChange={(e) => setFAsentable(e.target.value as FiltroAsentable)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
            <option value="todos">Tipo: todas</option>
            <option value="asentable">Asentables</option>
            <option value="agrupadora">Agrupadoras</option>
          </select>
          <select value={fCentroCosto} onChange={(e) => setFCentroCosto(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
            <option value="">Centro costo: todos</option>
            <option value="si">Con centro de costo</option>
            <option value="no">Sin centro de costo</option>
          </select>
          <select value={fMoneda} onChange={(e) => setFMoneda(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
            <option value="">Moneda: todas</option>
            {monedasDisponibles.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <select value={fEstado} onChange={(e) => setFEstado(e.target.value as FiltroEstado)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
            <option value="todos">Estado: todos</option>
            <option value="activas">Activas</option>
            <option value="inactivas">Inactivas</option>
          </select>
        </div>
        {hayFiltro && (
          <p className="text-xs text-slate-500">
            Mostrando {flatRows.length} fila(s) que coinciden (con su jerarquía). El árbol se expande automáticamente.
          </p>
        )}
      </div>

      {actionError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{actionError}</div>
      )}

      {/* Tabla / árbol */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-b bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2.5 text-left">Cuenta</th>
              <th className="px-3 py-2.5 text-left">Denominación</th>
              <th className="px-3 py-2.5 text-center">Nivel</th>
              <th className="px-3 py-2.5 text-center">Naturaleza</th>
              <th className="px-3 py-2.5 text-center">Asentable</th>
              <th className="px-3 py-2.5 text-center">C. Costo</th>
              <th className="px-3 py-2.5 text-left">Moneda</th>
              <th className="px-3 py-2.5 text-left">T. Cambio</th>
              <th className="px-3 py-2.5 text-left">Cuenta SSET</th>
              <th className="px-3 py-2.5 text-center">Estado</th>
              <th className="px-3 py-2.5 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows />
            ) : loadError ? (
              <tr>
                <td colSpan={11} className="px-3 py-8 text-center text-red-600">
                  {loadError}
                </td>
              </tr>
            ) : flatRows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-3 py-8 text-center text-slate-400">
                  No hay cuentas que coincidan.
                </td>
              </tr>
            ) : (
              flatRows.map(({ c, depth, hasChildren }) => {
                const isOpen = visibleIds ? true : expanded.has(c.id);
                return (
                  <tr key={c.id} className={`border-b last:border-0 hover:bg-slate-50/60 ${!c.activo ? "opacity-50" : ""}`}>
                    <td className="px-3 py-2">
                      <div className="flex items-center" style={{ paddingLeft: depth * 18 }}>
                        {hasChildren ? (
                          <button
                            onClick={() => toggle(c.id)}
                            className="mr-1 rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                            aria-label={isOpen ? "Contraer" : "Expandir"}
                          >
                            {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          </button>
                        ) : (
                          <span className="mr-1 inline-block h-4 w-4" />
                        )}
                        <span className={`font-mono ${c.asentable ? "text-slate-700" : "font-semibold text-slate-900"}`}>
                          {c.cuenta}
                        </span>
                      </div>
                    </td>
                    <td className={`px-3 py-2 ${c.asentable ? "text-slate-600" : "font-semibold text-slate-800"}`}>
                      {c.denominacion}
                    </td>
                    <td className="px-3 py-2 text-center text-slate-500">{c.nivel}</td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                          c.naturaleza === "D" ? "bg-blue-50 text-blue-700" : "bg-purple-50 text-purple-700"
                        }`}
                      >
                        {c.naturaleza}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {c.asentable ? (
                        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">Sí</span>
                      ) : (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500">Agrup.</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center text-slate-500">{c.centro_costo ? "Sí" : "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{c.moneda ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{c.tipo_cambio ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-500">{c.cuenta_sset ?? "—"}</td>
                    <td className="px-3 py-2 text-center">
                      {c.activo ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Activa</span>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">Inactiva</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEditar(c)}
                          className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-[#3F8E91]"
                          title="Editar"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => toggleActivo(c)}
                          className={`rounded p-1.5 hover:bg-slate-100 ${c.activo ? "text-slate-400 hover:text-amber-600" : "text-slate-400 hover:text-emerald-600"}`}
                          title={c.activo ? "Desactivar" : "Reactivar"}
                        >
                          <Power className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => eliminar(c)}
                          className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          title="Eliminar"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <PlanCuentaFormModal
        open={formOpen}
        editing={editing}
        cuentas={cuentas}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          load();
        }}
      />
      {importOpen && (
        <PlanCuentasImportModal
          onClose={() => setImportOpen(false)}
          onCompleted={() => {
            load();
          }}
        />
      )}
    </GlobalConfigSubpageShell>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <tr key={i} className="border-b last:border-0">
          <td colSpan={11} className="px-3 py-2.5">
            <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
          </td>
        </tr>
      ))}
    </>
  );
}
