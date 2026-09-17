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
  window_open?: boolean | null;
  queue_id?: string | null;
};

export type AsesorCola = { id: string; nombre: string };
export type AsesorCanal = { id: string; nombre: string; tipo: string | null };

type InboxResponse = {
  ok: boolean;
  is_agent?: boolean;
  queues?: AsesorCola[];
  channels?: AsesorCanal[];
  conversations?: AsesorConv[];
  error?: string;
  /** Puesto por el cliente: la lista vino de la ruta de supervisión. */
  supervision?: boolean;
};

const KEY = "/api/mobile/asesor/conversations";
const KEY_SUPERVISION = "/api/mobile/supervision/conversations";

async function pedir(url: string): Promise<InboxResponse> {
  const res = await fetchWithSupabaseSession(url, { cache: "no-store" });
  const data = (await res.json()) as InboxResponse;
  if (!res.ok || !data?.ok) throw new Error(data?.error || "No se pudo cargar");
  return data;
}

/**
 * Asesor → sus chats asignados. Quien no es agente (admin, supervisor) recibe `is_agent:false`
 * y se le muestra el inbox del escritorio con su alcance, en vez de una pantalla vacía.
 */
async function fetchInbox([, cola, canal]: [string, string, string]): Promise<InboxResponse> {
  const p = new URLSearchParams();
  if (cola) p.set("cola", cola);
  if (canal) p.set("canal", canal);
  const qs = p.toString() ? `?${p.toString()}` : "";
  const propia = await pedir(`${KEY}${qs}`);
  if (propia.is_agent !== false) return propia;
  const sup = await pedir(`${KEY_SUPERVISION}${qs}`);
  return { ...sup, is_agent: false, supervision: true };
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
export function useAsesorInbox(cola = "", canal = "") {
  const swr = useSWR<InboxResponse>([KEY, cola, canal], fetchInbox, {
    refreshInterval: 20_000,
    revalidateOnFocus: true,
    keepPreviousData: true,
  });
  return {
    conversations: swr.data?.conversations ?? [],
    isAgent: swr.data?.is_agent !== false,
    supervision: swr.data?.supervision === true,
    queues: swr.data?.queues ?? [],
    channels: swr.data?.channels ?? [],
    /** Sólo mientras no haya NADA que mostrar; con cache previo no se ve el skeleton. */
    isLoading: swr.isLoading && !swr.data,
    error: swr.error as Error | undefined,
    refresh: swr.mutate,
  };
}
