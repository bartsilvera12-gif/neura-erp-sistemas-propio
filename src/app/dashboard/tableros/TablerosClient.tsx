"use client";

/**
 * Tableros — los tableros reservados de Desarrollo.
 *
 * Junta las lecturas de cartera que antes vivían como pestañas del Dashboard:
 * el panel gerencial de Proyectos y el Dashboard Ejecutivo. Se mudaron acá
 * porque el Dashboard lo ve toda la empresa y esta información no.
 *
 * El acceso NO lo decide esta pantalla: el módulo `tableros` es restringido
 * (ver `lib/modulos/modulos-restringidos.ts`) y sólo lo ve quien tenga una fila
 * explícita en `usuario_modulos`. Esta página además lo verifica contra la API,
 * porque esconder un ítem del menú nunca fue un permiso: la URL se escribe a
 * mano.
 */

import { useEffect, useState } from "react";
import { BarChart3, LineChart, Lock } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import PanelProyectosPanel from "@/components/proyectos/PanelProyectosPanel";
import DashboardEjecutivoClient from "@/app/dashboard/proyectos/ejecutivo/DashboardEjecutivoClient";

type Tab = "ejecutivo" | "proyectos";

const TABS: { id: Tab; label: string; Icon: typeof LineChart }[] = [
  { id: "ejecutivo", label: "Ejecutivo", Icon: LineChart },
  { id: "proyectos", label: "Proyectos", Icon: BarChart3 },
];

export default function TablerosClient() {
  const [tab, setTab] = useState<Tab>("ejecutivo");
  const [acceso, setAcceso] = useState<"cargando" | "ok" | "denegado">("cargando");

  useEffect(() => {
    let cancel = false;
    // `/api/empresas/mis-modulos` devuelve el ARRAY de módulos efectivos, ya
    // pasado por el resolver — que es donde vive la regla de módulo restringido.
    fetchWithSupabaseSession("/api/empresas/mis-modulos", { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json().catch(() => [])) as { slug?: string }[] | { error?: string };
        if (cancel) return;
        const lista = Array.isArray(j) ? j : [];
        const tiene = lista.some((m) => (m.slug ?? "").trim().toLowerCase() === "tableros");
        setAcceso(tiene ? "ok" : "denegado");
      })
      .catch(() => {
        if (!cancel) setAcceso("denegado");
      });
    return () => {
      cancel = true;
    };
  }, []);

  if (acceso === "cargando") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">
        <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-[#4FAEB2]" />
        Cargando…
      </div>
    );
  }

  if (acceso === "denegado") {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
          <Lock className="h-5 w-5 text-slate-400" />
        </span>
        <p className="text-sm font-medium text-slate-700">Este módulo es de acceso restringido</p>
        <p className="max-w-sm text-xs text-slate-400">
          Si necesitás entrar, pedí que te habiliten el módulo Tableros.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 pb-2">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
              tab === id
                ? "bg-[#4FAEB2] text-white shadow-sm"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === "ejecutivo" ? <DashboardEjecutivoClient /> : <PanelProyectosPanel />}
    </div>
  );
}
