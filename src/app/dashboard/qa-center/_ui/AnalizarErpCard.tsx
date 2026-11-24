"use client";

/**
 * Card del proyecto en QA Center.
 *
 * UI simplificada: un único botón primario "Ejecutar sandbox" que encola
 * el run del agente interactivo. Debajo: métricas resumidas, checklist de
 * prerrequisitos, cobertura por módulo del último análisis y el informe
 * si existe. Nada de Playwright-Açaí ni HTTP-checks ad-hoc: el agente
 * genérico cubre todo.
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

  async function ejecutarSandbox(): Promise<void> {
    setCargando(true); setErr(null); setOk(null);
    try {
      const res = await fetch(`/api/qa/interactuar-agente/${props.projectId}`, {
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
      setOk(`Sandbox encolado · run ${body.run_id?.slice(0, 8) ?? "?"}`);
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error de red");
    } finally {
      setCargando(false);
    }
  }

  const totalesDiscovery = props.lastDiscovery?.totales ?? null;

  return (
    <div
      className="mt-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      data-testid="analizar-erp-card"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Agente QA · sandbox interactivo
          </p>
          <h3 className="mt-1 text-base font-semibold text-slate-900">
            Ejecutar pruebas funcionales
          </h3>
          <p className="mt-1 text-xs text-slate-600">
            Levanta una copia temporal del ERP y el agente navega la UI con
            Playwright: descubre módulos, prueba altas, búsquedas y lecturas.
            Base ficticia; nunca toca producción. Requiere{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px]">target_base_url</code>{" "}
            cargado.
          </p>
        </div>
        <button
          onClick={() => void ejecutarSandbox()}
          disabled={cargando}
          data-testid={`btn-ejecutar-sandbox-${props.projectSlug}`}
          className="shrink-0 rounded-lg bg-[#0EA5E9] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0284C7] disabled:opacity-60"
        >
          {cargando ? "Encolando…" : "Ejecutar sandbox"}
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-rose-700">Error: {err}</p>}
      {ok && <p className="mt-2 text-xs text-emerald-700">{ok}</p>}

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
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
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
          <p className="text-slate-500">Costo acumulado (IA)</p>
          <p className="mt-0.5 font-medium text-slate-800">
            USD {props.totalCostUsd.toFixed(4)}{" "}
            <span className="text-slate-500">/ límite USD 2.00 por corrida</span>
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
