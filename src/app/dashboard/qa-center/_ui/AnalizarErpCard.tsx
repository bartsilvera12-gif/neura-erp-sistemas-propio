"use client";

/**
 * Card principal del proyecto: botón único "Analizar ERP completo".
 * Debajo: prerrequisitos, cobertura por módulo del último análisis e informe
 * en español sencillo. La sección manual queda colapsada como "Avanzado".
 */

import { useState } from "react";
import PrerequisitosChecklist from "./PrerequisitosChecklist";
import CoberturaIAViewer, { type CoberturaModulo } from "./CoberturaIAViewer";
import InformeIaViewer from "./InformeIaViewer";

type DiscoveryResumen = {
  created_at: string;
  modulos: Array<{ nombre: string; totalRutas?: number }> | null;
  totales: Record<string, number> | null;
};
type InformeResumen = {
  resumen: string;
  modulos: Array<{
    nombre: string;
    funciona_bien?: string[];
    fallas?: Array<{
      funcion_revisada?: string;
      resultado_esperado?: string;
      resultado_obtenido?: string;
      recomendacion?: string;
    }>;
    pendientes?: Array<{ funcion_revisada?: string; motivo?: string }>;
  }>;
  parcial?: boolean;
  created_at: string;
};

export type AnalizarErpCardProps = {
  projectId: string;
  projectSlug: string;
  projectName: string;
  lastDiscovery: DiscoveryResumen | null;
  lastInforme: InformeResumen | null;
  totalCostUsd: number;
  cobertura: CoberturaModulo[];
  togglePermiteLectura: boolean;
  anthropicConfigured: boolean | null;
  credencialesRoRunnerConfigured: boolean | null;
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
            de negocio, generamos y ejecutamos pruebas funcionales de lectura, y
            emitimos un informe en español. Sin modificar el ERP ni enviar mensajes.
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
            USD {props.totalCostUsd.toFixed(4)} <span className="text-slate-500">/ límite USD 2.00 por corrida</span>
          </p>
        </div>
      </div>

      <PrerequisitosChecklist
        togglePermiteLectura={props.togglePermiteLectura}
        anthropicConfigured={props.anthropicConfigured}
        credencialesRoRunnerConfigured={props.credencialesRoRunnerConfigured}
      />

      <CoberturaIAViewer cobertura={props.cobertura} />

      {props.lastInforme && (
        <InformeIaViewer
          resumen={props.lastInforme.resumen}
          modulos={props.lastInforme.modulos}
          parcial={props.lastInforme.parcial}
          createdAt={props.lastInforme.created_at}
        />
      )}
    </div>
  );
}
