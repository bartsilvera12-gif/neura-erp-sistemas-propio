/**
 * POST /api/qa/runner/credenciales
 *
 * El runner (autenticado por HMAC) pide las credenciales QA de un proyecto.
 * Reemplaza el modelo viejo de `QA_SANDBOX_EMAIL/PASSWORD` global del runner.
 *
 * Body: { project_slug: string }
 * Respuesta 200: { data: Array<{ label, rol, email, password, notas }> }
 *
 * Seguridad:
 *   - HMAC obligatorio (mismo que /claim, /heartbeat, /init-sql).
 *   - Descifrado con QA_CREDENTIALS_ENC_KEY del lado server.
 *   - Logs: NUNCA emite `email` o `password` — solo `label` y `rol`.
 *   - El runner recibe SOLO credenciales activas. Las desactivadas no cuentan.
 *   - Actualiza last_used_at para alertar de credenciales huérfanas.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRunner } from "@/lib/qa/runner-auth";
import { buildQaNonceStore } from "@/lib/qa/route-helpers";
import { withQaClient } from "@/lib/qa/pg-pool";
import {
  obtenerCredencialesParaRunner,
  CredentialsConfigError,
} from "@/lib/qa/project-credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  project_slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
});

export async function POST(request: Request) {
  try {
    const nonceStore = buildQaNonceStore();
    if (!nonceStore) {
      return NextResponse.json(
        { error: "QA_DB_URL no configurada", code: "internal" },
        { status: 500 }
      );
    }
    const auth = await authenticateRunner(request, nonceStore);
    if (!auth.ok) return auth.response;

    const raw = (() => {
      try {
        return auth.bodyJson();
      } catch {
        return null;
      }
    })();
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "payload inválido", code: "validation", detail: parsed.error.message },
        { status: 400 }
      );
    }
    const slug = parsed.data.project_slug;

    const creds = await withQaClient((c) =>
      obtenerCredencialesParaRunner(c, slug)
    );

    // Log explícito SIN campos sensibles — solo cuántas y qué labels.
    console.info(
      "[runner/credenciales] slug=%s count=%d labels=%s",
      slug,
      creds.length,
      creds.map((c) => c.label).join(",") || "(ninguna)"
    );

    return NextResponse.json({ data: creds });
  } catch (err) {
    if (err instanceof CredentialsConfigError) {
      // Esta clase es segura de devolver al runner — no revela el valor de la key.
      return NextResponse.json({ error: err.message, code: "config" }, { status: 500 });
    }
    const msg = err instanceof Error ? err.message : "error";
    console.error("[runner/credenciales POST] error:", msg);
    return NextResponse.json(
      { error: "obtener credenciales falló", code: "internal_exception" },
      { status: 500 }
    );
  }
}
