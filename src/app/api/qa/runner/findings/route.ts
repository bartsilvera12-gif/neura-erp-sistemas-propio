/**
 * NEURA QA CENTER — `POST /api/qa/runner/findings`
 * El runner reporta findings de la auditoría estática tras clonar el repo.
 * Auth: HMAC del runner (mismo mecanismo que claim/report-result).
 */

import { NextResponse } from "next/server";
import { authenticateRunner } from "@/lib/qa/runner-auth";
import { handleReportFindings } from "@/lib/qa/handlers";
import { buildQaNonceStore, buildQaRepo } from "@/lib/qa/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const nonceStore = buildQaNonceStore();
  if (!nonceStore) {
    return NextResponse.json({ error: "QA_DB_URL no configurada o Postgres inalcanzable", code: "internal" }, { status: 500 });
  }
  const auth = await authenticateRunner(request, nonceStore);
  if (!auth.ok) return auth.response;

  const repo = buildQaRepo();
  if (!repo) {
    return NextResponse.json({ error: "QA_DB_URL no configurada o Postgres inalcanzable", code: "internal" }, { status: 500 });
  }
  // authenticateRunner ya consumio el stream con request.text(), asi que
  // request.json() aqui devolvia null/throw. Usamos el helper que reutiliza
  // el texto ya leido.
  let body: unknown;
  try {
    body = auth.bodyJson();
  } catch {
    return NextResponse.json({ error: "body no es JSON", code: "validation" }, { status: 400 });
  }
  const result = await handleReportFindings({ runnerId: auth.runnerId, body, repo });
  return NextResponse.json(result.body, { status: result.status });
}
