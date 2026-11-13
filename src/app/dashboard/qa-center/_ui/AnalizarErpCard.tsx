"use client";

/**
 * Card principal del proyecto: botón único "Analizar ERP completo".
 * Debajo: últimos resultados IA y costo acumulado. La sección manual queda
 * colapsada como "Avanzado".
 */

import { useState } from "react";

type DiscoveryResumen = {
  created_at: string;
  modulos: Array<{ nombre: string; totalRutas?: number }> | null;
  totales: Record<string, number> | null;
};
type InformeResumen = {
  resumen: string;
  modulos: Array<{ nombre: string; funciona_bien?: string[]; fallas?: Array<{ funcion_revisada?: string; recomendacion?: string }> }>;
  created_at: string;
};

export type AnalizarErpCardProps = {
  projectId: string;
  projectSlug: string;
  projectName: string;
  lastDiscovery: DiscoveryResumen | null;
  lastInforme: InformeResumen | null;
  totalCostUsd: number;
};

export default function AnalizarErpCard(props: AnalizarErpCardProps) {
  const [cargando, setCargando] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function analizar(): Promise<void> {
    setCargando(true); setErr(null); setOk(null);
    try {
      const res = await fetch(`/api/qa/analizar-erp/${props.projectId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientRequestId: `ui-${Date.now()}` }),
      });
      const text = await res.text();
      let body: { run_id?: string; error?: string } = {};
      try { body = text ? JSON.parse(text) : {}; } catch { /* no-json */ }
      if (!res.ok) {
        setErr(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setOk(`Run encolado: ${body.run_id?.slice(0, 8) ?? "?"}`);
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error de red");
    } finally {
      setCargando(false);
    }
  }

  const totalesDiscovery = props.lastDiscovery?.totales ?? null;

  return (
    <div className="mt-3 rounded-lg border-2 border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-4" data-testid="analizar-erp-card">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-indigo-700">
            NEURA QA · Agente de control de calidad
          </p>
          <h3 className="mt-0.5 text-lg font-semibold text-slate-900">
            Analizar ERP completo
          </h3>
          <p className="mt-1 text-xs text-slate-600">
            Cloná el repositorio, descubrimos los módulos, interpretamos las reglas
            de negocio y preparamos pruebas funcionales de lectura. Sin modificar
            el ERP ni enviar mensajes.
          </p>
        </div>
        <button
          onClick={() => void analizar()}
          disabled={cargando}
          data-testid={`btn-analizar-${props.projectSlug}`}
          className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-60"
        >
          {cargando ? "Encolando…" : "Analizar ERP completo"}
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-rose-700">Error: {err}</p>}
      {ok && <p className="mt-2 text-xs text-emerald-700">{ok}</p>}

      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <div className="rounded border bg-white p-2">
          <p className="text-slate-500">Últimos descubrimientos</p>
          {totalesDiscovery ? (
            <p className="mt-0.5 font-medium text-slate-800">
              {Number(totalesDiscovery.modulos ?? 0)} módulos ·{" "}
              {Number(totalesDiscovery.endpoints ?? 0)} endpoints ·{" "}
              {Number(totalesDiscovery.tablas ?? 0)} tablas
            </p>
          ) : (
            <p className="mt-0.5 text-slate-400">todavía no analizado</p>
          )}
        </div>
        <div className="rounded border bg-white p-2">
          <p className="text-slate-500">Costo acumulado (IA)</p>
          <p className="mt-0.5 font-medium text-slate-800">
            USD {props.totalCostUsd.toFixed(4)}
          </p>
        </div>
      </div>

      {props.lastInforme && (
        <div className="mt-3 rounded border bg-white p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Último informe IA</p>
          <p className="mt-1 text-sm text-slate-800">{props.lastInforme.resumen}</p>
          {Array.isArray(props.lastInforme.modulos) && props.lastInforme.modulos.length > 0 && (
            <ul className="mt-2 space-y-2 text-xs">
              {props.lastInforme.modulos.slice(0, 6).map((m, i) => (
                <li key={i} className="rounded bg-slate-50 p-2">
                  <p className="font-semibold text-slate-700">{m.nombre}</p>
                  {Array.isArray(m.funciona_bien) && m.funciona_bien.length > 0 && (
                    <p className="text-emerald-700">
                      ✓ Funciona: {m.funciona_bien.slice(0, 2).join(" · ")}
                    </p>
                  )}
                  {Array.isArray(m.fallas) && m.fallas.length > 0 && (
                    <p className="text-rose-700">
                      ✗ {m.fallas.length} hallazgo(s)
                      {m.fallas[0]?.recomendacion ? ` — ${m.fallas[0].recomendacion}` : ""}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
