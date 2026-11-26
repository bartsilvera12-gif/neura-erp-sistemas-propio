"use client";

/**
 * Listas de Inventario que se sienten instantáneas (Productos, Movimientos, Vencimientos y
 * las secciones de la ficha del producto):
 *   · cache en memoria por URL (filtros + página): volver a algo ya visto pinta en el
 *     primer render y se refresca en segundo plano (stale-while-revalidate)
 *   · mientras llega una página nueva quedan las filas anteriores (sin parpadeo a vacío)
 *   · AbortController: una respuesta vieja nunca pisa a una nueva (búsqueda tecleada rápido)
 *   · pedidos en curso compartidos: StrictMode (dev) o precarga + click → UN solo request
 *   · precargarLista(url): deja lista la página siguiente o la ficha antes del click
 * Por pestaña y por usuario: al cerrar sesión o cambiar de usuario se vacía.
 * (Independiente de @/lib/api/cache-cliente a propósito: ese es para catálogos con TTL.)
 */
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { browserClient } from "@/erp2/lib/supabase/browser";

type Entrada = { datos: unknown; json: string; at: number };
type Vuelo = { promesa: Promise<Entrada>; ctrl: AbortController; interesados: number; precarga: boolean };

const memo = new Map<string, Entrada>();
const MAX_ENTRADAS = 80;
const enVuelo = new Map<string, Vuelo>();
/** Lo guardado más nuevo que esto no se vuelve a pedir (precarga recién hecha). */
const FRESCO_MS = 5_000;

let usuario: string | null | undefined; // undefined = todavía no se sabe
let escuchando = false;

/** Al cambiar de usuario (logout / login en la misma pestaña) se olvida todo. */
function escucharSesion() {
  if (escuchando || typeof window === "undefined") return;
  escuchando = true;
  try {
    browserClient().auth.onAuthStateChange((_evento, sesion) => {
      const u = sesion?.user.id ?? null;
      if (usuario !== undefined && u !== usuario) {
        memo.clear();
        for (const v of enVuelo.values()) v.ctrl.abort();
        enVuelo.clear();
      }
      usuario = u;
    });
  } catch {
    /* sin cliente de auth (tests/SSR): el cache igual vive solo en esta pestaña */
  }
}

function guardar(url: string, e: Entrada) {
  memo.delete(url);
  if (memo.size >= MAX_ENTRADAS) memo.delete(memo.keys().next().value!);
  memo.set(url, e);
}

/** Path sin query: "/api/productos?paginado=1…" → "/api/productos". */
const pathDe = (url: string) => url.split("?")[0];

function pedir(url: string, precarga: boolean, nuevo = false): Vuelo {
  const hit = enVuelo.get(url);
  // `nuevo` (después de guardar algo): no sirve un request que salió ANTES del cambio.
  if (hit && !nuevo && !hit.ctrl.signal.aborted) {
    if (!precarga) hit.precarga = false;
    return hit;
  }
  const ctrl = new AbortController();
  const pedidoEn = Date.now();
  const vuelo: Vuelo = {
    ctrl,
    interesados: 0,
    precarga,
    promesa: apiFetch<unknown>(url, { signal: ctrl.signal })
      .then((datos) => {
        const e: Entrada = { datos, json: JSON.stringify(datos), at: pedidoEn };
        // Si mientras tanto llegó algo pedido DESPUÉS, no se lo pisa con esto más viejo.
        const actual = memo.get(url);
        if (!actual || actual.at <= pedidoEn) guardar(url, e);
        return e;
      })
      .finally(() => { if (enVuelo.get(url) === vuelo) enVuelo.delete(url); }),
  };
  vuelo.promesa.catch(() => {});
  enVuelo.set(url, vuelo);
  return vuelo;
}

function soltar(v: Vuelo) {
  // El abort real espera un instante: si enseguida llega otro que quiere lo mismo
  // (StrictMode monta dos veces) se suma al request en curso en vez de repetirlo.
  if (--v.interesados <= 0 && !v.precarga) {
    setTimeout(() => { if (v.interesados <= 0 && !v.precarga) v.ctrl.abort(); }, 100);
  }
}

/** Deja una URL lista en memoria (página siguiente, hover). Errores: silencio. */
export function precargarLista(url: string) {
  if (typeof window === "undefined") return;
  escucharSesion();
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < FRESCO_MS) return;
  pedir(url, true);
}

/** Olvida todo lo guardado de un path (todas sus páginas y filtros): después de editar. */
export function invalidarLista(path: string) {
  for (const url of [...memo.keys()]) if (pathDe(url) === path || url.startsWith(`${path}/`)) memo.delete(url);
}

/** Lo guardado para una URL, sincrónico (estado inicial: pinta sin "Cargando…"). */
export function guardadoLista<T>(url: string | null): T | undefined {
  return url ? (memo.get(url)?.datos as T | undefined) : undefined;
}

/**
 * GET cacheado para una pantalla. `url` null = todavía no pedir.
 * `recarga`: al cambiar (después de guardar algo) se olvidan las otras páginas del mismo
 * path y se pide de nuevo sin usar lo guardado.
 * → datos: lo último recibido (puede ser de la URL anterior mientras llega la nueva)
 *   cargando: lo que se muestra todavía no es de `url`
 *   error: falló y no había nada guardado para `url`
 */
export function useListaCacheada<T>(url: string | null, recarga = 0) {
  const [estado, setEstado] = useState<{ datos: T | null; de: string | null; json: string | null; error: boolean }>(() => {
    const hit = url ? memo.get(url) : undefined;
    return { datos: (hit?.datos as T) ?? null, de: hit ? url : null, json: hit?.json ?? null, error: false };
  });
  const recargaVista = useRef(recarga);

  useEffect(() => {
    if (!url) return;
    escucharSesion();
    const forzar = recarga !== recargaVista.current;
    recargaVista.current = recarga;
    if (forzar) {
      invalidarLista(pathDe(url));
      // Igual que antes de guardar: las filas quedan (atenuadas) hasta que llegan las nuevas.
      setEstado((s) => (s.de === null ? s : { ...s, de: null }));
    }
    const hit = forzar ? undefined : memo.get(url);
    if (hit) {
      // Pinta lo guardado ya (si no es lo que ya se muestra) y revalida en segundo plano.
      setEstado((s) => (s.de === url && s.json === hit.json ? s : { datos: hit.datos as T, de: url, json: hit.json, error: false }));
      if (Date.now() - hit.at < FRESCO_MS) return;
    }
    const v = pedir(url, false, forzar);
    v.interesados++;
    let vivo = true;
    v.promesa
      .then((e) => {
        if (!vivo) return;
        // Misma respuesta que la que se muestra → no re-renderiza.
        setEstado((s) => (s.de === url && s.json === e.json ? s : { datos: e.datos as T, de: url, json: e.json, error: false }));
      })
      .catch(() => {
        if (vivo && !hit) setEstado((s) => ({ ...s, de: url, error: true }));
      });
    return () => {
      vivo = false;
      soltar(v);
    };
  }, [url, recarga]);

  return { datos: estado.datos, cargando: !!url && estado.de !== url, error: estado.de === url && estado.error };
}
