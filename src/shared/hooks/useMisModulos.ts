"use client";

import useSWR from "swr";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type ModuloSlug = { id: string; nombre: string; slug: string };

const KEY = "/api/empresas/mis-modulos";

async function fetchMisModulos(): Promise<ModuloSlug[]> {
  const res = await fetchWithSupabaseSession(KEY, { cache: "no-store" });
  if (!res.ok) {
    if (res.status === 401) return [];
    throw new Error("No se pudieron cargar los módulos");
  }
  const data = (await res.json().catch(() => null)) as unknown;
  return Array.isArray(data) ? (data as ModuloSlug[]) : [];
}

/**
 * Módulos efectivos del usuario logueado, con cache.
 *
 * El endpoint ya aplica el resolver completo — incluida la regla de módulo restringido
 * (`MODULOS_RESTRINGIDOS`), que es lo que permite habilitar una vista para una sola
 * persona desde /usuarios/[id] sin tocar código. Acá no se decide nada: solo se lee.
 *
 * Cambia muy poco (hay que editar al usuario para que cambie), así que no se revalida
 * en foco ni por intervalo: alcanza con el cache persistido y una revalidación al montar.
 */
export function useMisModulos() {
  const swr = useSWR<ModuloSlug[]>(KEY, fetchMisModulos, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });
  const slugs = swr.data ?? null;
  return {
    modulos: slugs ?? [],
    /** null mientras no sabemos todavía: sirve para no parpadear la navegación. */
    tieneModulo: (slug: string): boolean | null => {
      if (slugs == null) return null;
      const s = slug.trim().toLowerCase();
      return slugs.some((m) => (m.slug ?? "").trim().toLowerCase() === s);
    },
    isLoading: swr.isLoading && !swr.data,
    error: swr.error as Error | undefined,
  };
}
