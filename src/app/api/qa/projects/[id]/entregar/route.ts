/**
 * NEURA QA CENTER — `POST /api/qa/projects/[id]/entregar`
 *
 * Marca el proyecto como entregado al cliente. Bloqueo TOTAL de QA Desarrollo
 * desde este punto (ni siquiera pruebas de lectura pueden encolarse).
 *
 * Operación irreversible desde la UI. Si se necesita volver a hacer QA, hay
 * que crear un nuevo proyecto (típicamente contra otra instancia).
 */

import { NextResponse } from "next/server";
import { assertQaCenterAccess } from "@/lib/qa/auth";
import { buildQaRepo } from "@/lib/qa/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await assertQaCenterAccess(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "id debe ser UUID", code: "validation" }, { status: 400 });
  }

  const repo = buildQaRepo();
  if (!repo) return NextResponse.json({ error: "QA_DB_URL no configurada", code: "internal" }, { status: 500 });

  const project = await repo.getProject(id);
  if (!project) return NextResponse.json({ error: "proyecto no existe", code: "not_found" }, { status: 404 });

  const updated = await repo.entregarProyecto({ project_id: id, usuario_id: auth.user.id });
  if (!updated) {
    return NextResponse.json({ error: "no se pudo marcar como entregado", code: "internal" }, { status: 500 });
  }
  return NextResponse.json({ data: updated }, { status: 200 });
}
