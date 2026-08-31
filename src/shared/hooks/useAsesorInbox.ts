"use client";

import useSWR from "swr";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

export type AsesorConv = {
  id: string;
  status: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
  contact_nombre: string | null;
  contact_telefono: string | null;
  window_open: boolean | null;
};

type InboxResponse = { ok: boolean; is_agent?: boolean; conversations?: AsesorConv[]; error?: string };

const KEY = "/api/mobile/asesor/conversations";

async function fetchInbox(): Promise<InboxResponse> {
  const res = await fetchWithSupabaseSession(KEY, { cache: "no-store" });
  const data = (await res.json()) as InboxResponse;
  if (!res.ok || !data?.ok) throw new Error(data?.error || "No se pudo cargar");
  return data;
}

/**
 * Lista de conversaciones del asesor, con cache.
 *
 * El endpoint es caro: por debajo usa `fetchChatConversations`, el motor del inbox
 * de escritorio (clasificación de flujos, scope omnicanal, contactos por lote, etc.)
 * del que el móvil aprovecha sólo ocho campos. Antes se refetcheaba desde cero en
 * cada montaje, así que volver atrás desde un chat costaba lo mismo que la carga
 * inicial. Con SWR + el cache persistido en localStorage del SWRPersistedProvider,
 * el retroceso pinta al instante y revalida en segundo plano.
 *
 * `refreshInterval` y `revalidateOnFocus` reemplazan al setInterval y al listener
 * de visibilitychange que tenía la página.
 */
export function useAsesorInbox() {
  const swr = useSWR<InboxResponse>(KEY, fetchInbox, {
    refreshInterval: 20_000,
    revalidateOnFocus: true,
    keepPreviousData: true,
  });
  return {
    conversations: swr.data?.conversations ?? [],
    isAgent: swr.data?.is_agent !== false,
    /** Sólo mientras no haya NADA que mostrar; con cache previo no se ve el skeleton. */
    isLoading: swr.isLoading && !swr.data,
    error: swr.error as Error | undefined,
    refresh: swr.mutate,
  };
}
