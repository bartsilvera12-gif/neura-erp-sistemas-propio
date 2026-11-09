"use client";

import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Resp<T> = { success: boolean; data?: T; error?: string };

/** Llamada a la API de Gestión de Personal. Tira Error con el mensaje del servidor. */
export async function apiPersonal<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...resto } = init ?? {};
  const res = await fetchWithSupabaseSession(url, {
    cache: "no-store",
    ...resto,
    headers: json !== undefined ? { "Content-Type": "application/json", ...(resto.headers ?? {}) } : resto.headers,
    body: json !== undefined ? JSON.stringify(json) : resto.body,
  });
  const j = (await res.json().catch(() => null)) as Resp<T> | null;
  if (!res.ok || !j?.success) throw new Error(j?.error || `Error ${res.status}`);
  return j.data as T;
}

/** Sube un documento (multipart). Devuelve el id creado. */
export async function subirDocumento(usuarioId: string, file: File, nombre?: string): Promise<{ id: string }> {
  const fd = new FormData();
  fd.append("file", file);
  if (nombre) fd.append("nombre", nombre);
  const res = await fetchWithSupabaseSession(`/api/personal/${usuarioId}/documentos`, { method: "POST", body: fd });
  const j = (await res.json().catch(() => null)) as Resp<{ id: string }> | null;
  if (!res.ok || !j?.success) throw new Error(j?.error || `Error ${res.status}`);
  return j.data as { id: string };
}

export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function tamanoLegible(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
