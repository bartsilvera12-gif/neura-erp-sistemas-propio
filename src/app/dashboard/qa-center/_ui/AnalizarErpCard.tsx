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
import { useRouter } from "next/navigation";
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
  const router = useRouter();
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
      setTimeout(() => router.refresh(), 1200);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error de red");
    } finally {
      setCargando(false);
    }
  }

  const totalesDiscovery = props.lastDiscovery?.totales ?? null;

  return (
    <div
      className="overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-white to-[#7DCFD2]/5 shadow-sm"
      data-testid="analizar-erp-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 bg-gradient-to-r from-[#0EA5E9]/5 via-white to-white p-5">
        <div className="min-w-0 flex-1">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-[#0EA5E9]/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#0284C7] ring-1 ring-[#0EA5E9]/20">
            <span className="relative inline-flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#0EA5E9] opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#0EA5E9]" />
            </span>
            Agente IA · sandbox interactivo
          </div>
          <h3 className="mt-2 text-lg font-semibold text-slate-900">
            Ejecutar pruebas funcionales
          </h3>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-600">
            El agente levanta una copia temporal del ERP y recorre la UI con
            Playwright: descubre módulos, prueba altas, búsquedas y lecturas.
            Base ficticia; nunca toca producción.
          </p>
        </div>
        <button
          onClick={() => void ejecutarSandbox()}
          disabled={cargando}
          data-testid={`btn-ejecutar-sandbox-${props.projectSlug}`}
          className="group/btn inline-flex shrink-0 items-center gap-2 rounded-xl bg-gradient-to-r from-[#0EA5E9] to-[#0284C7] px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-[#0EA5E9]/20 transition-all hover:from-[#0284C7] hover:to-[#0369A1] hover:shadow-lg hover:shadow-[#0EA5E9]/30 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:shadow-md"
        >
          {cargando ? (
            <>
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              Encolando…
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="transition-transform group-hover/btn:translate-x-0.5">
                <polygon points="6 3 20 12 6 21" />
              </svg>
              Ejecutar sandbox
            </>
          )}
        </button>
      </div>

      {(err || ok) && (
        <div className={`px-5 py-2 text-xs font-medium ${err ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"}`}>
          {err ? `⚠ ${err}` : `✓ ${ok}`}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 p-5 pb-4 sm:grid-cols-2">
        <MetricTile
          icon="radar"
          label="Últimos descubrimientos"
          value={totalesDiscovery
            ? `${Number(totalesDiscovery.modulos ?? 0)} módulos · ${Number(totalesDiscovery.endpoints ?? 0)} endpoints · ${Number(totalesDiscovery.tablas ?? 0)} tablas`
            : "todavía no analizado"}
          muted={!totalesDiscovery}
        />
        <MetricTile
          icon="coin"
          label="Costo acumulado (IA)"
          value={`USD ${props.totalCostUsd.toFixed(4)}`}
          hint="límite USD 2.00 por corrida"
        />
      </div>

      <div className="border-t border-slate-100 bg-slate-50/40 px-5 py-4">
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
    </div>
  );
}

function MetricTile({
  icon,
  label,
  value,
  hint,
  muted,
}: {
  icon: "radar" | "coin";
  label: string;
  value: string;
  hint?: string;
  muted?: boolean;
}) {
  const paths: Record<"radar" | "coin", React.ReactNode> = {
    radar: (<><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></>),
    coin:  (<><circle cx="12" cy="12" r="10" /><path d="M12 6v12" /><path d="M9 9h4.5a2.5 2.5 0 0 1 0 5H9m0-5v10m0-5h5a2.5 2.5 0 0 1 0 5H9" /></>),
  };
  return (
    <div className="group/tile flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 transition-all hover:border-[#7DCFD2]/60 hover:shadow-sm">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 transition-colors group-hover/tile:bg-[#7DCFD2]/20 group-hover/tile:text-[#0B3A3D]">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {paths[icon]}
        </svg>
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <p className={`mt-0.5 text-xs font-semibold ${muted ? "font-normal text-slate-400" : "text-slate-800"}`}>
          {value}
        </p>
        {hint && <p className="mt-0.5 text-[10px] text-slate-400">{hint}</p>}
      </div>
    </div>
  );
}
