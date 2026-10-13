"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Config = { activo: boolean; revenue_min: number; recurrencia_min: number };
type Celda = { revenue_desde: number; recurrencia_desde: number; porcentaje: number };

const fmtGs = (n: number) => new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 }).format(Math.round(n));
const fmtMM = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toLocaleString("es-PY", { maximumFractionDigits: 2 })}M` : fmtGs(n));

/**
 * Editor de la matriz de comisiones (Revenue × Recurrencia → %). Modelo "sin sueldo base".
 * Comisión = revenue × % de la celda. Gate: revenue >= revenue_min Y recurrencia >= recurrencia_min.
 */
export default function MatrizComisionEditor() {
  const [loading, setLoading] = useState(true);
  const [disponible, setDisponible] = useState(false);
  const [puedeEditar, setPuedeEditar] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [config, setConfig] = useState<Config>({ activo: false, revenue_min: 15000000, recurrencia_min: 500000 });
  // porcentajes[revenue_desde][recurrencia_desde] = "2.5"
  const [pct, setPct] = useState<Record<string, Record<string, string>>>({});
  const [revenues, setRevenues] = useState<number[]>([]);
  const [recurrencias, setRecurrencias] = useState<number[]>([]);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithSupabaseSession("/api/comisiones/matriz", { cache: "no-store" });
      const j = (await res.json()) as { success?: boolean; data?: { disponible: boolean; config: Config; celdas: Celda[]; puedeEditar: boolean } };
      if (!res.ok || !j.success || !j.data) throw new Error("No se pudo cargar la matriz.");
      const d = j.data;
      setDisponible(d.disponible);
      setPuedeEditar(d.puedeEditar);
      setConfig(d.config);
      const revs = [...new Set(d.celdas.map((c) => c.revenue_desde))].sort((a, b) => a - b);
      const recs = [...new Set(d.celdas.map((c) => c.recurrencia_desde))].sort((a, b) => a - b);
      setRevenues(revs);
      setRecurrencias(recs);
      const m: Record<string, Record<string, string>> = {};
      for (const c of d.celdas) {
        (m[c.revenue_desde] ??= {})[c.recurrencia_desde] = String(c.porcentaje);
      }
      setPct(m);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const setCelda = (r: number, c: number, v: string) =>
    setPct((prev) => ({ ...prev, [r]: { ...(prev[r] ?? {}), [c]: v.replace(",", ".") } }));

  const guardar = async () => {
    setGuardando(true);
    setErr(null);
    setMsg(null);
    try {
      const celdas: Celda[] = [];
      for (const r of revenues) for (const c of recurrencias) {
        const raw = pct[r]?.[c] ?? "0";
        celdas.push({ revenue_desde: r, recurrencia_desde: c, porcentaje: parseFloat(raw) || 0 });
      }
      const res = await fetchWithSupabaseSession("/api/comisiones/matriz", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config, celdas }),
      });
      const j = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !j.success) throw new Error(j.error ?? "No se pudo guardar.");
      setMsg("Matriz guardada.");
      await cargar();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setGuardando(false);
    }
  };

  const inputCls = "w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-right text-sm tabular-nums focus:border-[#4FAEB2] focus:outline-none focus:ring-1 focus:ring-[#4FAEB2]/30 disabled:bg-slate-50 disabled:text-slate-400";

  if (loading) return <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-400">Cargando matriz…</div>;
  if (!disponible)
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        La matriz de comisiones no está disponible para esta empresa.
      </div>
    );

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span aria-hidden className="block h-5 w-1 rounded-full bg-[#4FAEB2]" />
            <h2 className="text-lg font-semibold text-slate-900">Matriz de comisiones (Revenue × Recurrencia)</h2>
          </div>
          <p className="mt-1 max-w-3xl text-xs text-slate-500">
            Comisión = <span className="font-semibold">Revenue × % de la celda</span>. Se cobra solo si se cumplen
            las 2 condiciones del gate. Caés en la fila/columna por <span className="font-semibold">piso alcanzado</span>;
            arriba del máximo se usa el último tramo. Bajo cada % ves el monto que daría en ese piso de revenue.
          </p>
        </div>
      </div>

      {/* Config / Gate */}
      <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4 sm:grid-cols-3">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={config.activo}
            disabled={!puedeEditar}
            onChange={(e) => setConfig((c) => ({ ...c, activo: e.target.checked }))}
            className="h-4 w-4 rounded border-slate-300 accent-[#4FAEB2]"
          />
          Usar esta matriz para calcular (si no, se usa la política por escalas)
        </label>
        <label className="text-xs font-semibold text-slate-500">
          Gate · Revenue mínimo (Gs)
          <input
            type="number"
            value={config.revenue_min}
            disabled={!puedeEditar}
            onChange={(e) => setConfig((c) => ({ ...c, revenue_min: Number(e.target.value) || 0 }))}
            className={`${inputCls} mt-1 text-left`}
          />
        </label>
        <label className="text-xs font-semibold text-slate-500">
          Gate · Recurrencia mínima (Gs)
          <input
            type="number"
            value={config.recurrencia_min}
            disabled={!puedeEditar}
            onChange={(e) => setConfig((c) => ({ ...c, recurrencia_min: Number(e.target.value) || 0 }))}
            className={`${inputCls} mt-1 text-left`}
          />
        </label>
      </div>

      {/* Matriz */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-[132px]" />
            {recurrencias.map((c) => (
              <col key={c} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b border-slate-200">
              <th className="sticky left-0 z-10 bg-white px-3 py-3 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Revenue \ Recurrencia
              </th>
              {recurrencias.map((c) => (
                <th key={c} className="bg-[#4FAEB2]/5 px-3 py-3 text-center text-sm font-bold text-[#3F8E91]">
                  {fmtMM(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {revenues.map((r) => (
              <tr key={r} className="hover:bg-[#4FAEB2]/[0.03]">
                <td className="sticky left-0 z-10 bg-white px-3 py-2.5 text-left text-sm font-bold text-slate-700">
                  {fmtMM(r)}
                </td>
                {recurrencias.map((c) => {
                  const raw = pct[r]?.[c] ?? "";
                  const p = parseFloat(raw) || 0;
                  return (
                    <td key={c} className="px-2.5 py-2 align-top">
                      <div className="relative">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={raw}
                          disabled={!puedeEditar}
                          onChange={(e) => setCelda(r, c, e.target.value)}
                          className={`${inputCls} pr-6 text-base`}
                        />
                        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">%</span>
                      </div>
                      <div className="mt-1 text-right text-[11px] font-medium text-slate-400">≈ Gs {fmtGs((r * p) / 100)}</div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{err}</div>}
      {msg && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</div>}

      {puedeEditar && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={guardar}
            disabled={guardando}
            className="rounded-xl bg-[#4FAEB2] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#3F8E91] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
          >
            {guardando ? "Guardando…" : "Guardar matriz"}
          </button>
        </div>
      )}
    </section>
  );
}
