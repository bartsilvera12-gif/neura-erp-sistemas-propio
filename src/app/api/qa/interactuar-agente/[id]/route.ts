/**
 * NEURA QA CENTER — POST /api/qa/interactuar-agente/[id]
 *
 * Dispara el modo `interaction_sandbox`: el runner levanta un entorno efímero
 * (Coolify: postgres + app desde GitHub) y el agente Claude navega la UI con
 * Playwright, haciendo operaciones ficticias. NUNCA opera contra producción:
 * el claim adapter traduce la suite `ai-interaction-<slug>` a
 * `safety_level=interaction_sandbox`, que a su vez activa el dispatcher de
 * qa-sessions en el runner.
 *
 * Funciona para proyectos en desarrollo y entregados: el sandbox usa una copia
 * efímera (postgres + app) que nunca toca la base productiva del cliente.
 * Precondición: `target_base_url` presente en qa_center.projects.
 */

import { NextResponse } from "next/server";
import { assertQaCenterAccess } from "@/lib/qa/auth";
import { buildQaRepo } from "@/lib/qa/route-helpers";
import { handleInteractuarAgente } from "@/lib/qa/handle-analizar-erp";

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
    const result = await handleInteractuarAgente({
      projectId: id,
      userId: auth.user.id,
      clientRequestId: typeof body.clientRequestId === "string" ? body.clientRequestId : null,
      repo,
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "error";
    console.error("[interactuar-agente POST] error:", err);
    return NextResponse.json({ error: msg, code: "internal_exception" }, { status: 500 });
  }
}
