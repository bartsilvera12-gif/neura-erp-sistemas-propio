/**
 * Cache local persistente del inbox de Conversaciones (localStorage), estilo "local-first"
 * liviano: al abrir el módulo o un chat se pinta AL INSTANTE desde el cache y se sincroniza
 * en segundo plano contra el servidor/Realtime. El cache es solo un acelerador de percepción;
 * la fuente de verdad sigue siendo la red. Todo es defensivo (quota/SSR/JSON) — nunca tira.
 *
 * Acotado para no explotar el localStorage (~5MB): tope de conversaciones en la lista, tope
 * de mensajes por hilo y un LRU de hilos (se descartan los menos usados).
 */

const NS = "conv-cache:v1";
const LIST_MAX = 60; // máximo de conversaciones cacheadas por vista
const THREAD_MSG_MAX = 80; // máximo de mensajes cacheados por hilo (los más recientes)
const THREAD_LRU_MAX = 20; // máximo de hilos guardados (los últimos usados)

function safeGet<T>(key: string): T | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function safeSet(key: string, value: unknown): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota llena, modo privado o localStorage deshabilitado → se ignora */
  }
}

function safeRemove(key: string): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(key);
  } catch {
    /* noop */
  }
}

// ── Lista del inbox por vista (ventas / bot / etc.) ─────────────────────────
export function readInboxList<T>(vista: string): T[] | null {
  const rows = safeGet<T[]>(`${NS}:list:${vista}`);
  return Array.isArray(rows) ? rows : null;
}

export function writeInboxList<T>(vista: string, rows: T[]): void {
  if (!Array.isArray(rows)) return;
  safeSet(`${NS}:list:${vista}`, rows.slice(0, LIST_MAX));
}

// ── Hilo (mensajes) por conversación, con LRU ───────────────────────────────
export function readThread<T>(conversationId: string): T[] | null {
  const id = conversationId.trim();
  if (!id) return null;
  const rows = safeGet<T[]>(`${NS}:thread:${id}`);
  return Array.isArray(rows) ? rows : null;
}

export function writeThread<T>(conversationId: string, msgs: T[]): void {
  const id = conversationId.trim();
  if (!id || !Array.isArray(msgs)) return;
  // Guardamos solo los últimos N mensajes (los más recientes) para acotar tamaño.
  safeSet(`${NS}:thread:${id}`, msgs.slice(-THREAD_MSG_MAX));
  touchThreadLru(id);
}

/** Mantiene el índice LRU y descarta los hilos más viejos que superen el tope. */
function touchThreadLru(conversationId: string): void {
  const idxKey = `${NS}:thread-lru`;
  const prev = safeGet<string[]>(idxKey) ?? [];
  const next = [conversationId, ...prev.filter((x) => x !== conversationId)];
  const keep = next.slice(0, THREAD_LRU_MAX);
  for (const id of next.slice(THREAD_LRU_MAX)) safeRemove(`${NS}:thread:${id}`);
  safeSet(idxKey, keep);
}
