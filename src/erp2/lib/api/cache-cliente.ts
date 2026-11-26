/**
 * Cache chico del lado del cliente para GETs que casi no cambian (/api/me, categorías…).
 *
 *   const r = await apiFetchCache<{ categorias: Categoria[] }>("/api/inventario/categorias");
 *   invalidar("/api/inventario/categorias");   // después de crear/editar/borrar
 *
 * - TTL corto (60 s por defecto): pasado ese tiempo se vuelve a pedir.
 * - Dedupe: si dos pantallas piden lo mismo a la vez, sale UN solo request.
 * - La clave incluye el usuario de la sesión: si cambia el usuario (logout/login en la
 *   misma pestaña) nunca se le muestran datos del anterior.
 * - Los errores no se guardan: el próximo pedido reintenta.
 */
import { browserClient } from "@/erp2/lib/supabase/browser";
import { apiFetch } from "@/erp2/lib/api/client-fetch";

const TTL_MS = 60_000;

type Entrada = { hasta: number; promesa: Promise<unknown> };
const cache = new Map<string, Entrada>();

// Último usuario visto: deja leer lo guardado SIN esperar a getSession (para pintar en el
// primer render). Cambia en cada usuarioActual(); limpiarCache() lo olvida.
let ultimoUsuario: string | null = null;

async function usuarioActual(): Promise<string> {
  try {
    const { data } = await browserClient().auth.getSession();
    return (ultimoUsuario = data.session?.user.id ?? "anon");
  } catch {
    return (ultimoUsuario = "anon");
  }
}

/**
 * GET con cache + dedupe. Para cualquier otro método usar apiFetch directo.
 * `fresco: true` ignora lo guardado, pide de nuevo y deja el resultado en el cache.
 */
export async function apiFetchCache<T = unknown>(url: string, opts: { ttlMs?: number; fresco?: boolean } = {}): Promise<T> {
  const ttlMs = opts.ttlMs ?? TTL_MS;
  const clave = `${await usuarioActual()}|${url}`;
  const ahora = Date.now();
  const hit = cache.get(clave);
  if (!opts.fresco && hit && hit.hasta > ahora) return hit.promesa as Promise<T>;

  const promesa = apiFetch<T>(url);
  const entrada: Entrada = { hasta: ahora + ttlMs, promesa };
  cache.set(clave, entrada);
  promesa.catch(() => {
    // Un error no queda cacheado (solo si nadie la reemplazó mientras tanto).
    if (cache.get(clave) === entrada) cache.delete(clave);
  });
  return promesa;
}

// ── Datos ya vistos (stale-while-revalidate) ────────────────────────────────
// Para listas/fichas que SÍ cambian: se muestra al instante lo último que se vio y se
// pide de nuevo en segundo plano. Misma clave usuario|url que el cache de arriba.
// at = cuándo se PIDIÓ (no cuándo llegó): una respuesta que tardó no se toma por más nueva.
type Memo = { data: unknown; json: string; at: number };
const memo = new Map<string, Memo>();
const MEMO_MAX = 300;
// Pedidos en curso compartidos: el que llega segundo (StrictMode, prefetch + click)
// espera el mismo request. `esperando` cuenta quién lo quiere; si todos abortan, se
// aborta de verdad (y deja libre la conexión).
type EnCurso = { promesa: Promise<Memo>; ctrl: AbortController; esperando: number; precarga: boolean };
const enCurso = new Map<string, EnCurso>();

function guardarMemo(clave: string, m: Memo) {
  memo.delete(clave);
  if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value!);
  memo.set(clave, m);
}

function pedir(clave: string, url: string, precarga: boolean, nuevo = false): EnCurso {
  const hit = enCurso.get(clave);
  // `nuevo` (después de guardar): no sirve un request que salió ANTES del cambio.
  if (hit && !nuevo && !hit.ctrl.signal.aborted) {
    if (!precarga) hit.precarga = false;
    return hit;
  }
  const ctrl = new AbortController();
  const pedidoEn = Date.now();
  const entrada: EnCurso = {
    ctrl,
    esperando: 0,
    precarga,
    promesa: apiFetch<unknown>(url, { signal: ctrl.signal })
      .then((data) => {
        const m: Memo = { data, json: JSON.stringify(data), at: pedidoEn };
        // Si mientras tanto llegó algo pedido DESPUÉS, no se lo pisa con esto más viejo.
        const actual = memo.get(clave);
        if (!actual || actual.at <= pedidoEn) guardarMemo(clave, m);
        return m;
      })
      .finally(() => { if (enCurso.get(clave) === entrada) enCurso.delete(clave); }),
  };
  entrada.promesa.catch(() => {});
  enCurso.set(clave, entrada);
  return entrada;
}

/**
 * GET stale-while-revalidate. Llama `onDatos` con lo guardado (al instante, `viejo: true`)
 * y después con la respuesta nueva SOLO si cambió (no re-renderiza por nada).
 * - `maxEdadMs`: si lo guardado es más nuevo que esto, no se vuelve a pedir (default 0 = siempre).
 * - `fresco`: ignora lo guardado (después de guardar algo).
 * - `signal`: si se aborta, `onDatos` no se llama más (una respuesta vieja no pisa una nueva).
 * Devuelve true si hubo datos (guardados o nuevos); rechaza si falló y no había nada.
 */
export async function apiFetchSWR<T>(
  url: string,
  onDatos: (data: T, viejo: boolean) => void,
  opts: { maxEdadMs?: number; fresco?: boolean; signal?: AbortSignal } = {},
): Promise<boolean> {
  const clave = `${await usuarioActual()}|${url}`;
  const { signal } = opts;
  if (signal?.aborted) return false;
  const hit = opts.fresco ? undefined : memo.get(clave);
  if (hit) {
    onDatos(hit.data as T, true);
    if (Date.now() - hit.at < (opts.maxEdadMs ?? 0)) return true;
  }
  const req = pedir(clave, url, false, opts.fresco);
  req.esperando++;
  // El abort real espera un instante: si enseguida llega otro que quiere lo mismo (StrictMode
  // en dev, o la ficha que se recarga) se suma al request en curso en vez de repetirlo.
  const alAbortar = () => {
    if (--req.esperando <= 0 && !req.precarga) {
      setTimeout(() => { if (req.esperando <= 0 && !req.precarga) req.ctrl.abort(); }, 100);
    }
  };
  signal?.addEventListener("abort", alAbortar, { once: true });
  try {
    const m = await req.promesa;
    if (signal?.aborted) return !!hit;
    if (!hit || hit.json !== m.json) onDatos(m.data as T, false);
    return true;
  } catch (e) {
    if (signal?.aborted || hit) return !!hit;
    throw e;
  } finally {
    signal?.removeEventListener("abort", alAbortar);
    if (!signal?.aborted) req.esperando--;
  }
}

/**
 * Deja una URL lista en memoria (hover sobre una fila, página siguiente). No hace nada si
 * ya está guardada hace menos de `maxEdadMs` o si ya se está pidiendo. Errores: silencio.
 */
export async function precargar(url: string, maxEdadMs = 15_000): Promise<void> {
  const clave = `${await usuarioActual()}|${url}`;
  const hit = memo.get(clave);
  if (hit && Date.now() - hit.at < maxEdadMs) return;
  pedir(clave, url, true);
}

/**
 * Lo guardado para una URL, SINCRÓNICO (para el estado inicial de un componente: vuelve a
 * la pantalla y pinta en el primer render, sin "Cargando…"). Usa el último usuario visto.
 */
export function guardadoAlInstante<T>(url: string): T | undefined {
  if (!ultimoUsuario) return undefined;
  return memo.get(`${ultimoUsuario}|${url}`)?.data as T | undefined;
}

/**
 * Olvida una URL cacheada (para todos los usuarios de la pestaña). Sin query string
 * también borra sus variantes: invalidar("/api/inventario/categorias") borra
 * "/api/inventario/categorias?todas=1&conteo=1". Vale para los dos caches.
 */
export function invalidar(url: string) {
  for (const m of [cache, memo] as Map<string, unknown>[]) {
    for (const clave of [...m.keys()]) {
      const u = clave.slice(clave.indexOf("|") + 1);
      if (u === url || (!url.includes("?") && u.startsWith(`${url}?`))) m.delete(clave);
    }
  }
}

/** Vacía todo el cache (al cerrar sesión). */
export function limpiarCache() {
  cache.clear();
  memo.clear();
  ultimoUsuario = null;
  for (const r of enCurso.values()) r.ctrl.abort();
  enCurso.clear();
}
