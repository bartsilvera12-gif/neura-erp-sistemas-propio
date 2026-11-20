/**
 * NEURA QA CENTER — `POST /api/qa/projects/[id]/autorizar`
 *
 * Firma la autorización de QA Desarrollo sobre un proyecto por 72h.
 * Body (JSON): { declaraciones: { no_entregado, datos_ficticios, integraciones_aisladas } }
 *
 * Reglas:
 *   - El proyecto no puede estar en `entregado` (bloqueo total).
 *   - Las 3 declaraciones deben llegar en `true`.
 *   - Escribe fila en qa_center.project_autorizaciones y entrada en audit_log.
 *   - NO reemplaza env-assert ni el gate de ejecución: sólo habilita la ventana.
 */

import { NextResponse } from "next/server";
import { assertQaCenterAccess } from "@/lib/qa/auth";
import { buildQaRepo } from "@/lib/qa/route-helpers";
import {
  validarDeclaraciones,
  calcularVencimiento,
} from "@/lib/qa/project-estado";

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
  if (project.estado_entrega === "entregado") {
    return NextResponse.json(
      { error: "El proyecto fue entregado al cliente — no se puede re-autorizar QA.", code: "project_entregado" },
      { status: 403 }
    );
  }

  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "JSON inválido", code: "validation" }, { status: 400 }); }

  const d = (body.declaraciones ?? body) as Record<string, unknown>;
  const dec = validarDeclaraciones({
    no_entregado: d.no_entregado === true,
    datos_ficticios: d.datos_ficticios === true,
    integraciones_aisladas: d.integraciones_aisladas === true,
  });
  if (!dec.ok) {
    return NextResponse.json({ error: dec.razon, code: "validation", field: "declaraciones" }, { status: 400 });
  }

  const vence = calcularVencimiento();
  const updated = await repo.autorizarProyecto({
    project_id: id,
    usuario_id: auth.user.id,
    declaraciones: dec.declaraciones,
    autorizado_hasta: vence.toISOString(),
  });
  if (!updated) {
    return NextResponse.json({ error: "no se pudo actualizar el proyecto", code: "internal" }, { status: 500 });
  }
  return NextResponse.json({ data: updated }, { status: 200 });
}
