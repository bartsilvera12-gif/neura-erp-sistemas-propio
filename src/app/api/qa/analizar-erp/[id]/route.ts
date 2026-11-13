/**
 * NEURA QA CENTER — POST /api/qa/analizar-erp/[id]
 *
 * Dispara el pipeline IA de "Analizar ERP completo".
 * Encola un run con safety_level=discovery que el runner ejecuta así:
 *   - clona el repo
 *   - descubre módulos
 *   - (si ANTHROPIC_API_KEY está presente) corre comprensión + spec_gen
 *   - devuelve discovery + specs generados al QA Center
 */

import { NextResponse } from "next/server";
import { assertQaCenterAccess } from "@/lib/qa/auth";
import { buildQaRepo } from "@/lib/qa/route-helpers";
import { handleAnalizarErp } from "@/lib/qa/handle-analizar-erp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await assertQaCenterAccess(request);
    if (!auth.ok) return auth.response;
    const { id } = await context.params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "id debe ser UUID", code: "validation" }, { status: 400 });
    }
    const body = await request.json().catch(() => ({})) as { clientRequestId?: string };
    const repo = buildQaRepo();
    if (!repo) {
      return NextResponse.json({ error: "QA_DB_URL no configurada", code: "internal" }, { status: 500 });
    }
    const result = await handleAnalizarErp({
      projectId: id,
      userId: auth.user.id,
      clientRequestId: typeof body.clientRequestId === "string" ? body.clientRequestId : null,
      repo,
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "error";
    console.error("[analizar-erp POST] error:", err);
    return NextResponse.json({ error: msg, code: "internal_exception" }, { status: 500 });
  }
}
