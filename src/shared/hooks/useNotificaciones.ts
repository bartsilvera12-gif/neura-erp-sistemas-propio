"use client";

import useSWR from "swr";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

export type NotificacionTipo =
  | "qa_novedad"
  | "qa_aprobado"
  | "qa_rechazado"
  | "esqueleto_por_vencer"
  | "esqueleto_vencido"
  | "proyecto_estado_cambio"
  | "proyecto_entregado"
  | "cobro_pendiente"
  | "comentario_proyecto"
  | "agenda_recordatorio"
  | "qa_vence"
  | "chat_interno_mensaje"
  | "conversacion_asignada"
  | "conversacion_mensaje";

export type Notificacion = {
  id: string;
  tipo: NotificacionTipo;
  titulo: string;
  cuerpo: string | null;
  proyecto_id: string | null;
  observacion_id: string | null;
  agrupadas: number;
  leida_at: string | null;
  created_at: string;
  metadata?: {
    canal?: string;
    sala_id?: string;
    mencion?: boolean;
    conversation_id?: string;
  } | null;
  /** Aviso calculado en vivo por la API, sin fila en la base: NO se puede marcar leído. */
  derivada?: boolean;
  minutos_restantes?: number;
  cita_id?: string;
};

type ApiResp = {
  success?: boolean;
  data?: { notificaciones: Notificacion[]; no_leidas: number };
  error?: string;
};

/**
 * Avisos del usuario logueado — los mismos que muestra la campanita del escritorio.
 *
 * A diferencia de la campanita, acá NO se usa Realtime: dentro de la app el WebView se
 * suspende al pasar a segundo plano y la suscripción queda muerta sin avisar. Un refresco
 * por intervalo y al volver el foco es más aburrido pero no miente. Es el mismo respaldo
 * que la campanita ya tiene por si el Realtime falla en algún tenant.
 */
export function useNotificaciones(opts?: { limit?: number; enabled?: boolean }) {
  const limit = opts?.limit ?? 30;
  const key = `/api/notificaciones?limit=${limit}`;
  /* `enabled: false` (p. ej. la barra de pestañas cuando el usuario no tiene la vista)
     no pide nada: sin esto se golpeaba la API en cada pantalla para nada. */
  const swr = useSWR<ApiResp>(
    opts?.enabled === false ? null : key,
    async () => {
      const res = await fetchWithSupabaseSession(key, { cache: "no-store" });
      const j = (await res.json().catch(() => ({}))) as ApiResp;
      if (!res.ok) throw new Error(j?.error || "No se pudieron cargar los avisos");
      return j;
    },
    { refreshInterval: 60_000, revalidateOnFocus: true, keepPreviousData: true }
  );

  /** `ids` puntuales o `todas`. Las derivadas no se pueden marcar: no tienen fila. */
  async function marcarLeidas(body: { ids?: string[]; todas?: boolean; proyecto_id?: string }) {
    try {
      await fetchWithSupabaseSession("/api/notificaciones/marcar-leidas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      /* si falla, el próximo refresco lo vuelve a mostrar sin leer: no rompe nada */
    }
    await swr.mutate();
  }

  return {
    notificaciones: swr.data?.data?.notificaciones ?? [],
    noLeidas: swr.data?.data?.no_leidas ?? 0,
    isLoading: swr.isLoading && !swr.data,
    error: swr.error as Error | undefined,
    refresh: swr.mutate,
    marcarLeidas,
  };
}

/**
 * A dónde lleva un aviso DENTRO de la app del asesor.
 *
 * Solo se linkean los dos destinos que existen adentro: la conversación y el proyecto.
 * Agenda, cobranzas y chat interno viven únicamente en el dashboard, y mandar ahí te
 * expulsaría de la app — que es justo lo que estuvimos sacando. Esos avisos se leen y se
 * marcan como leídos, pero no navegan.
 */
export function destinoEnApp(n: Notificacion): string | null {
  const convId = n.metadata?.conversation_id;
  if ((n.tipo === "conversacion_asignada" || n.tipo === "conversacion_mensaje") && convId) {
    return `/m/asesor/chat/${convId}`;
  }
  if (n.proyecto_id) {
    const tab = n.tipo === "comentario_proyecto" ? "?tab=comentarios" : "";
    return `/m/asesor/proyectos/${n.proyecto_id}${tab}`;
  }
  return null;
}
