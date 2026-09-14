"use client";

import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { supabase } from "@/lib/supabase";
import type { CatalogosSoporte } from "@/lib/soporte/dominio";

type Resp<T> = { success: boolean; data?: T; error?: string };

/** Llamada a la API de Soporte. Tira un Error con el mensaje del servidor. */
export async function apiSoporte<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
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

export type Persona = {
  id: string;
  nombre: string;
  rol: string | null;
  area: string;
  es_project_manager: boolean;
  es_tecnico: boolean;
  es_qa: boolean;
};

export type CatalogosConEquipo = CatalogosSoporte & {
  personas: Persona[];
  puede_configurar: boolean;
  usuario_id: string;
};

let cacheCatalogos: { valor: CatalogosConEquipo; vence: number } | null = null;

/**
 * Catálogos + equipo, con una memoria corta: casi todas las pantallas del módulo
 * los necesitan, y cambian sólo desde Configuración (que invalida la caché).
 */
export async function obtenerCatalogos(forzar = false): Promise<CatalogosConEquipo> {
  if (!forzar && cacheCatalogos && cacheCatalogos.vence > Date.now()) return cacheCatalogos.valor;
  const valor = await apiSoporte<CatalogosConEquipo>("/api/soporte/catalogos");
  cacheCatalogos = { valor, vence: Date.now() + 60_000 };
  return valor;
}

export function invalidarCatalogos() {
  cacheCatalogos = null;
}

/**
 * Sube archivos a un ticket, directo al Storage.
 *
 * Tres pasos por archivo: pedir una URL firmada (el servidor valida tipo y
 * tamaño y decide la ruta), subir desde el navegador sin pasar por Vercel, y
 * registrar el archivo (el servidor verifica que el objeto exista dentro de la
 * carpeta del ticket). Si uno falla, los demás siguen.
 */
export async function subirArchivos(
  ticketId: string,
  archivos: File[],
  opciones?: { comentarioId?: string; descripcion?: string; alAvanzar?: (hechos: number, total: number) => void }
): Promise<{ subidos: number; errores: string[] }> {
  const errores: string[] = [];
  let subidos = 0;
  for (const [i, f] of archivos.entries()) {
    try {
      const firma = await apiSoporte<{ bucket: string; path: string; token: string }>(
        `/api/soporte/tickets/${ticketId}/archivos/firmar`,
        { method: "POST", json: { nombre: f.name, mime_type: f.type, size: f.size } }
      );
      const up = await supabase.storage.from(firma.bucket).uploadToSignedUrl(firma.path, firma.token, f, {
        contentType: f.type || "application/octet-stream",
      });
      if (up.error) throw new Error(`"${f.name}": ${up.error.message}`);
      await apiSoporte(`/api/soporte/tickets/${ticketId}/archivos`, {
        method: "POST",
        json: {
          path: firma.path,
          nombre: f.name,
          mime_type: f.type,
          descripcion: opciones?.descripcion ?? null,
          comentario_id: opciones?.comentarioId ?? null,
        },
      });
      subidos++;
    } catch (e) {
      errores.push(e instanceof Error ? e.message : `No se pudo subir "${f.name}"`);
    }
    opciones?.alAvanzar?.(i + 1, archivos.length);
  }
  return { subidos, errores };
}

const PY = "Etc/GMT+3";

/** "14/09/2026 09:32" en hora de Paraguay. */
export function fechaHora(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  const partes = new Intl.DateTimeFormat("es-PY", {
    timeZone: PY,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const v = (t: string) => partes.find((p) => p.type === t)?.value?.padStart(2, "0") ?? "";
  return `${v("day")}/${v("month")}/${v("year")} ${v("hour")}:${v("minute")}`;
}

/** "14/09/2026" para fechas de calendario (YYYY-MM-DD) o instantes. */
export function fecha(valor: string | null | undefined): string {
  if (!valor) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    const [a, m, d] = valor.split("-");
    return `${d}/${m}/${a}`;
  }
  return fechaHora(valor).slice(0, 10);
}
