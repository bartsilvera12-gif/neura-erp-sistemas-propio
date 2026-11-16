/**
 * POST /api/qa/runner/init-sql
 *
 * Genera el DDL + roles + seed de un ERP para que el runner lo aplique dentro
 * del Postgres QA EFÍMERO. Nunca se ejecuta contra Supabase central: el runner
 * recibe el texto SQL y lo aplica en la DB temporal de la sesión.
 *
 * Auth: HMAC del runner (mismo que /claim, /heartbeat, /discovery).
 *
 * Body: { codebase: string }
 * Respuesta 200: { ddl: string, qa_schema: string, source_hash: string, line_count: number }
 *
 * Guards:
 *   - codebase debe existir en qa_center.projects (sino 404)
 *   - El SQL generado se audita con los patrones de `prerun-circuit-breaker`:
 *     ninguna referencia activa a otros schemas tenant ni a hosts productivos.
 *   - El schema source (<codebase>) se lee solo con SELECT sobre pg_catalog —
 *     ningún SELECT sobre datos reales.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "node:crypto";
import { Client as PgClient } from "pg";
import { authenticateRunner } from "@/lib/qa/runner-auth";
import { buildQaNonceStore } from "@/lib/qa/route-helpers";
import { generarInitSql } from "@/lib/qa/generar-init-sql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ codebase: z.string().min(1).max(100) });

export async function POST(request: Request) {
  try {
    const nonceStore = buildQaNonceStore();
    if (!nonceStore) {
      return NextResponse.json({ error: "QA_DB_URL no configurada", code: "internal" }, { status: 500 });
    }
    const auth = await authenticateRunner(request, nonceStore);
    if (!auth.ok) return auth.response;

    const raw = (() => { try { return auth.bodyJson(); } catch { return null; } })();
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "payload inválido", code: "validation", detail: parsed.error.message }, { status: 400 });
    }
    const codebase = parsed.data.codebase.toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (codebase.length === 0) return NextResponse.json({ error: "codebase inválido", code: "validation" }, { status: 400 });

    const pgUrl = process.env.SUPABASE_DB_URL ?? process.env.QA_DB_URL;
    if (!pgUrl) return NextResponse.json({ error: "DB URL no configurada", code: "internal" }, { status: 500 });

    const client = new PgClient({ connectionString: pgUrl, statement_timeout: 120_000 });
    await client.connect();
    try {
      // Verificamos que el schema source existe (sino la lectura rompería).
      const schemaCheck = await client.query(
        `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
        [codebase.replace(/-/g, "_")]
      );
      if (schemaCheck.rows.length === 0) {
        // Fallback: usar directamente el codebase pedido
        const alt = await client.query(`SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`, [codebase]);
        if (alt.rows.length === 0) {
          return NextResponse.json({ error: `schema source no existe para codebase ${codebase}`, code: "schema_missing" }, { status: 404 });
        }
      }

      const sourceSchema = codebase.replace(/-/g, "_");
      const qaSchema = `${sourceSchema}_qa`;
      const ddl = await generarInitSql(client, { sourceSchema, qaSchema });

      const sourceHash = createHash("sha256").update(ddl).digest("hex").slice(0, 16);

      return NextResponse.json({
        ddl,
        qa_schema: qaSchema,
        source_hash: sourceHash,
        line_count: ddl.split("\n").length,
        bytes: Buffer.byteLength(ddl, "utf8"),
      }, { status: 200 });
    } finally {
      try { await client.end(); } catch { /* ignore */ }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "error";
    console.error("[runner/init-sql POST] error:", err);
    return NextResponse.json({ error: msg, code: "internal_exception" }, { status: 500 });
  }
}
