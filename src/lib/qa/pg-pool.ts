/**
 * NEURA QA CENTER — pool pg.Pool EXCLUSIVO del módulo.
 *
 * - NO comparte conexiones con `chat-pg-pool.ts` ni con ningún otro módulo.
 * - Singleton vía `globalThis` (sobrevive HMR en dev).
 * - Límites conservadores: `max: 5`, `idleTimeoutMillis: 30s`,
 *   `connectionTimeoutMillis: 10s`, `query_timeout: 25s`, `statement_timeout: 25s`.
 * - Fail-closed: si `QA_DB_URL` no está seteada, `getQaPool()` devuelve null.
 *   Las rutas lo traducen a HTTP 500. **No hay fallback silencioso a Supabase.**
 * - Protección contra fugas: helper `withQaClient(fn)` libera la conexión
 *   siempre, aunque la función lance.
 */

import pg from "pg";

const GLOBAL_KEY = "__neura_QA_CENTER_PG_POOL_SINGLETON__" as const;

type GlobalWithPool = typeof globalThis & {
  [GLOBAL_KEY]?: pg.Pool;
};

function current(): pg.Pool | undefined {
  return (globalThis as GlobalWithPool)[GLOBAL_KEY];
}
function store(pool: pg.Pool): void {
  (globalThis as GlobalWithPool)[GLOBAL_KEY] = pool;
}

/**
 * Devuelve el pool compartido, o `null` si `QA_DB_URL` no está configurada.
 * No lanza: deja que las rutas decidan el status 500 con un mensaje claro.
 */
export function getQaPool(): pg.Pool | null {
  const url = process.env.QA_DB_URL?.trim();
  if (!url) return null;

  const existing = current();
  if (existing) return existing;

  const pool = new pg.Pool({
    connectionString: url,
    application_name: "qa-center",
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    query_timeout: 25_000,
    statement_timeout: 25_000,
    // SSL opcional; en el VPS self-host el driver negocia según el string.
    ssl: /sslmode=(require|verify)/.test(url) ? { rejectUnauthorized: false } : false,
  });

  // El pool de pg emite 'error' en clientes idle. Log, no crash.
  pool.on("error", (err) => {
    console.error("[qa-center pg pool] idle client error:", err.message);
  });

  store(pool);
  return pool;
}

/**
 * Ejecuta `fn(client)` dentro de una conexión tomada del pool, garantizando
 * `client.release()` en finally. Nunca filtra una conexión aunque `fn` lance.
 */
export async function withQaClient<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const pool = getQaPool();
  if (!pool) throw new Error("QA_DB_URL no configurada — operación denegada");
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * Ejecuta `fn(client)` dentro de una transacción (`BEGIN`/`COMMIT`).
 * `ROLLBACK` automático si `fn` lanza. Siempre libera la conexión.
 */
export async function withQaTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  return withQaClient(async (client) => {
    await client.query("BEGIN");
    try {
      const out = await fn(client);
      await client.query("COMMIT");
      return out;
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* ya rolled back */ }
      throw err;
    }
  });
}
