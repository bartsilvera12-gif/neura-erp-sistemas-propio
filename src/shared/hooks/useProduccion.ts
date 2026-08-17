"use client";

import useSWR from "swr";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type { ProduccionReport } from "@/lib/produccion/programacion-data";

/** Hook compartido para el reporte gerencial de producción del periodo (YYYY-MM). */
export function useProduccion(period?: string) {
  const p = period ?? currentPeriod();
  const swr = useSWR<ProduccionReport>(
    `produccion:programacion:${p}`,
    async () => {
      const res = await fetchWithSupabaseSession(`/api/produccion/programacion?period=${p}`, { cache: "no-store" });
      if (!res.ok) {
        const err = new Error(`Error ${res.status}`) as Error & { status?: number };
        err.status = res.status;
        throw err;
      }
      return res.json();
    },
    { revalidateOnFocus: false, revalidateIfStale: false, dedupingInterval: 5 * 60_000, keepPreviousData: true }
  );
  return {
    report: swr.data,
    isLoading: swr.isLoading,
    error: swr.error as (Error & { status?: number }) | undefined,
    mutate: swr.mutate,
  };
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
