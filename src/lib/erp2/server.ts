/**
 * Rutas `/api/v2/*`: responden como el ERP 2.0 (`{ ok, data }` / `{ ok: false, error: { message } }`)
 * para las pantallas traídas de ahí (src/erp2), pero leen y escriben las tablas de Neura.
 *
 * Quién puede: sesión de Neura + el módulo que corresponde (Inventario, Compras, Caja). Las
 * escrituras de stock pasan siempre por las funciones `neura.inv_*` (una transacción cada una).
 */
import { NextResponse } from "next/server";
import type { Pool, PoolClient } from "pg";
import { getAuthWithRol } from "@/lib/middleware/auth";
import { resolveEffectiveModules } from "@/lib/modulos/resolve-effective-modules";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";

export class ErrorV2 extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export const ok = (data: unknown, status = 200) => NextResponse.json({ ok: true, data }, { status });

/** Con mensaje nunca va 5xx: el proxy se come el cuerpo de los 5xx. */
export function fallo(err: unknown, donde: string) {
  if (err instanceof ErrorV2) {
    return NextResponse.json({ ok: false, error: { message: err.message } }, { status: err.status >= 500 ? 400 : err.status });
  }
  const e = err as { code?: string; message?: string };
  if (e?.code === "P0001" && e.message) {
    return NextResponse.json({ ok: false, error: { message: e.message } }, { status: 400 });
  }
  if (e?.code === "23505") {
    const msg = /sku/i.test(e.message ?? "") ? "Ya hay un producto con ese SKU." : /codigo_barras/i.test(e.message ?? "") ? "Ya hay un producto con ese código de barras." : "Ese dato ya existe.";
    return NextResponse.json({ ok: false, error: { message: msg } }, { status: 400 });
  }
  console.error(`[v2 ${donde}]`, e?.message ?? err);
  return NextResponse.json({ ok: false, error: { message: "No se pudo completar. Probá de nuevo." } }, { status: 500 });
}

export interface CtxV2 {
  empresaId: string;
  usuarioId: string;
  /** id de auth.users (FK de `pagos.usuario_id`, `facturas.anulado_por`). */
  authUserId: string | null;
  nombre: string;
  email: string | null;
  rol: string;
  esAdmin: boolean;
  modulos: Set<string>;
  pool: Pool;
}

/** Sesión + módulo. `modulo` vacío = solo sesión (para /me). */
export async function ctxV2(request: Request, modulo: string | null): Promise<CtxV2> {
  const auth = await getAuthWithRol(request);
  if (!auth?.empresa_id) throw new ErrorV2("No autenticado", 401);
  if (!auth.usuarioCatalogId) throw new ErrorV2("Tu usuario no está dado de alta en la empresa.", 403);
  const schema = await fetchDataSchemaForEmpresaId(auth.empresa_id);
  if (schema !== "neura") throw new ErrorV2("Esta pantalla todavía no está habilitada para esta empresa.", 403);
  const mods = await resolveEffectiveModules(createServiceRoleClient(), {
    id: auth.usuarioCatalogId,
    empresa_id: auth.empresa_id,
    rol: auth.rol ?? null,
  });
  const modulos = new Set(mods.map((m) => (m.slug ?? "").trim()).filter(Boolean));
  if (modulo && !modulos.has(modulo)) throw new ErrorV2("No tenés acceso a esta sección.", 403);
  const pool = getChatPostgresPool();
  if (!pool) throw new ErrorV2("Base no disponible.", 500);
  return {
    empresaId: auth.empresa_id,
    usuarioId: auth.usuarioCatalogId,
    authUserId: auth.user?.id ?? null,
    nombre: (auth.nombre ?? "").trim() || auth.user.email || "",
    email: auth.user.email ?? null,
    rol: auth.rol ?? "",
    esAdmin: esRolAdminEmpresaOGlobal(auth.rol),
    modulos,
    pool,
  };
}

/** Transacción con ROLLBACK si algo falla. */
export async function enTransaccion<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

export const esUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
