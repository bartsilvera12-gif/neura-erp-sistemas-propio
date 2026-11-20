/**
 * NEURA QA CENTER — endpoint de verificación de entorno.
 *
 * El runner Playwright llama a este endpoint ANTES de abrir el browser contra
 * el target. Si la respuesta no es 200 con `prod_safe: true`, el runner aborta.
 *
 * Seguridad:
 *   - En producción devuelve 403 con un payload mínimo (nunca expone detalles).
 *   - Nunca incluye secretos (keys, tokens, passwords, URLs con credenciales).
 *   - Nunca dice "env=production".
 *   - Ruta pública, sin auth: el runner puede no tener JWT del ERP target.
 *     Lo seguro aquí es NO devolver nada sensible en ningún entorno.
 *
 * Aditivo: no modifica ninguna ruta existente. Nuevo archivo.
 */

import { NextResponse } from "next/server";
import { buildEnvAssertResponse, detectEnv } from "@/lib/qa/env-assert";
import type { QaApiError } from "@/lib/qa/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const detection = detectEnv();

  if (detection.kind === "production") {
    const body: QaApiError = {
      error: "QA Center is not available in production.",
      code: "forbidden_production",
    };
    return NextResponse.json(body, {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const payload = buildEnvAssertResponse({
    env: detection.env,
    reasons: detection.reasons,
  });

  return NextResponse.json(payload, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
