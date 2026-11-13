/**
 * NEURA QA CENTER — PATCH /api/qa/admin/project/[id]
 *
 * Endpoint admin para alternar flags del proyecto que requieren decisión
 * explícita (no automatizable):
 *
 *   permite_lectura_sin_env_assert: habilita runs "authenticated_read_only"
 *   saltando el chequeo env-assert sobre el dominio. El admin del proyecto
 *   certifica con esto que ya creó un usuario QA de SÓLO LECTURA en el ERP y
 *   acepta la responsabilidad del run.
 *
 * Body: { permite_lectura_sin_env_assert: boolean }
 *
 * Auth: reusa assertQaCenterAccess (gate del panel). El flag toggle queda
 * registrado en qa_center.audit_log con el user id y el valor nuevo.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { assertQaCenterAccess } from "@/lib/qa/auth";
import { buildQaRepo } from "@/lib/qa/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z.object({
  permite_lectura_sin_env_assert: z.boolean(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await assertQaCenterAccess(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id debe ser UUID", code: "validation" }, { status: 400 });
  }

  const raw = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "payload inválido", code: "validation", detail: parsed.error.message },
      { status: 400 }
    );
  }

  const repo = buildQaRepo();
  if (!repo) return NextResponse.json({ error: "QA_DB_URL no configurada", code: "internal" }, { status: 500 });

  const project = await repo.getProject(id);
  if (!project) return NextResponse.json({ error: "proyecto no existe", code: "project_not_found" }, { status: 404 });

  const updated = await repo.setPermiteLecturaSinEnvAssert({
    project_id: id,
    valor: parsed.data.permite_lectura_sin_env_assert,
    actor_id: auth.user.id,
  });
  if (!updated) return NextResponse.json({ error: "no se pudo actualizar", code: "internal" }, { status: 500 });

  return NextResponse.json({ project: updated }, { status: 200 });
}
