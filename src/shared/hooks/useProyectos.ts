"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

export type EstadoProyecto = {
  id: string;
  nombre: string;
  codigo: string;
  color: string;
  sort_order: number;
  cuenta_sla?: boolean;
  sla_horas_objetivo?: number | null;
  es_estado_final?: boolean;
};

export type ProyectoCard = Record<string, unknown> & {
  id: string;
  titulo: string;
  prioridad: string;
  estado_id: string;
  last_activity_at?: string;
  fecha_ingreso?: string;
  fecha_prometida?: string | null;
  bloqueado?: boolean;
  archivado?: boolean;
  proyecto_tipo?: { nombre?: string; codigo?: string } | null;
  proyecto_estado?: {
    nombre?: string;
    codigo?: string;
    color?: string;
  } | null;
  cliente?: { tipo_cliente?: string | null; empresa?: string | null; nombre_contacto?: string | null; nombre?: string | null; razon_social?: string | null } | null;
  responsable_comercial?: { nombre?: string | null } | null;
  responsable_tecnico?: { nombre?: string | null } | null;
};

export type AlcanceProyectos = "mios" | "todos";

/** Misma clave que el Kanban de escritorio: la elección se comparte entre las dos vistas. */
const ALCANCE_KEY = "proyectos:alcance:v2";

/**
 * Alcance del listado: "mios" (donde soy responsable — comercial, técnico, QA o PM) o "todos".
 * Replica la lógica del Kanban de escritorio para que las dos pantallas se comporten igual:
 *
 *  - Recuerda la última elección por navegador.
 *  - El DEFAULT lo decide el servidor (`/api/proyectos/mi-vista`): gerencia, o quien no es
 *    responsable de ningún proyecto, arranca en "todos".
 *  - Un "Mías" guardado para alguien que NO es responsable de nada está siempre vacío, así
 *    que se corrige a "Todas".
 *
 * Queda en `null` hasta resolverlo, para no cargar con el alcance equivocado y que la lista
 * parpadee de "todas" a "mías".
 */
export function useProyectosAlcance() {
  const [alcance, setAlcance] = useState<AlcanceProyectos | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const s = window.localStorage.getItem(ALCANCE_KEY);
      return s === "mios" || s === "todos" ? s : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    let cancel = false;
    void (async () => {
      try {
        const r = await fetchWithSupabaseSession("/api/proyectos/mi-vista", { cache: "no-store" });
        const j = (await r.json().catch(() => ({}))) as {
          data?: { alcance_default?: AlcanceProyectos; es_responsable?: boolean };
        };
        const def: AlcanceProyectos = j.data?.alcance_default === "mios" ? "mios" : "todos";
        const esResponsable = j.data?.es_responsable === true;
        if (cancel) return;
        setAlcance((prev) => {
          if (prev === "mios" && !esResponsable) return "todos";
          return prev !== null ? prev : def;
        });
      } catch {
        if (!cancel) setAlcance((prev) => prev ?? "todos");
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (alcance === null) return;
    try {
      window.localStorage.setItem(ALCANCE_KEY, alcance);
    } catch {
      /* ignore */
    }
  }, [alcance]);

  return { alcance, setAlcance };
}

/** Hook compartido para la lista de proyectos (sin archivados por defecto). */
export function useProyectos(opts?: { archivado?: boolean; mios?: boolean | null }) {
  const params = new URLSearchParams();
  if (opts?.archivado === true) params.set("archivado", "1");
  if (opts?.mios === true) params.set("mios", "1");
  const qs = params.toString();
  /* `mios: null` = alcance sin resolver todavía: no pedimos nada, para no traer "todas"
     y que la lista parpadee cuando llegue la respuesta de mi-vista. */
  const swr = useSWR<ProyectoCard[]>(
    opts?.mios === null ? null : `proyectos:lista:${qs}`,
    async () => {
      const res = await fetchWithSupabaseSession(`/api/proyectos${qs ? `?${qs}` : ""}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const j = (await res.json()) as { success?: boolean; data?: ProyectoCard[] };
      return j.data ?? [];
    },
    { revalidateOnFocus: false, dedupingInterval: 2 * 60_000, keepPreviousData: true }
  );
  return {
    proyectos: swr.data ?? [],
    isLoading: swr.isLoading,
    error: swr.error as Error | undefined,
    mutate: swr.mutate,
  };
}

/** Hook compartido para los estados (columnas del kanban). */
export function useEstadosProyecto() {
  const swr = useSWR<EstadoProyecto[]>(
    "proyectos:estados",
    async () => {
      const res = await fetchWithSupabaseSession("/api/proyectos/estados", { cache: "no-store" });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const j = (await res.json()) as { success?: boolean; data?: EstadoProyecto[] };
      return (j.data ?? []).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    },
    { revalidateOnFocus: false, dedupingInterval: 5 * 60_000, keepPreviousData: true }
  );
  return {
    estados: swr.data ?? [],
    isLoading: swr.isLoading,
    error: swr.error as Error | undefined,
  };
}
