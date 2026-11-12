import { NextResponse } from "next/server";
import { authenticateRunner } from "@/lib/qa/runner-auth";
import { handleReportResult } from "@/lib/qa/handlers";
import { buildSupabaseRepo } from "@/lib/qa/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateRunner(request);
  if (!auth.ok) return auth.response;
  const repo = buildSupabaseRepo();
  if (!repo) {
    return NextResponse.json({ error: "Config Supabase no disponible", code: "internal" }, { status: 500 });
  }
  const { id } = await context.params;
  const result = await handleReportResult({
    runId: id,
    runnerId: auth.runnerId,
    body: auth.bodyJson(),
    repo,
  });
  return NextResponse.json(result.body, { status: result.status });
}
