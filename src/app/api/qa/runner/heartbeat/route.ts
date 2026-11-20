import { NextResponse } from "next/server";
import { authenticateRunner } from "@/lib/qa/runner-auth";
import { handleHeartbeat } from "@/lib/qa/handlers";
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
  const result = await handleHeartbeat({
    runnerId: auth.runnerId,
    body: auth.bodyJson(),
    repo,
  });
  return NextResponse.json(result.body, { status: result.status });
}
