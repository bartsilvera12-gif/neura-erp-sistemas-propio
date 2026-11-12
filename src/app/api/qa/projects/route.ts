/**
 * NEURA QA CENTER — `GET /api/qa/projects`
 * Lista proyectos del esquema `qa_center`. Solo super_admin (gating server-side).
 *
 * Si la migración todavía no corrió o el esquema no está expuesto por
 * PostgREST, responde `200 { data: [], migration_status, note }` para que el
 * panel muestre un estado vacío honesto (sin simular datos).
 */

import { NextResponse } from "next/server";
import { assertSuperAdmin } from "@/lib/qa/auth";
import { listQaProjects } from "@/lib/qa/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await assertSuperAdmin(request);
  if (!auth.ok) return auth.response;

  try {
    const result = await listQaProjects(auth.serviceClient);
    return NextResponse.json(result, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error inesperado";
    return NextResponse.json({ error: msg, code: "internal" }, { status: 500 });
  }
}
