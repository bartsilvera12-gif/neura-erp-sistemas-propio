import { NextResponse } from "next/server";
import { authenticateRunner } from "@/lib/qa/runner-auth";
import { handleHeartbeat } from "@/lib/qa/handlers";
import { buildSupabaseRepo } from "@/lib/qa/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await authenticateRunner(request);
  if (!auth.ok) return auth.response;
  const repo = buildSupabaseRepo();
  if (!repo) {
    return NextResponse.json({ error: "Config Supabase no disponible", code: "internal" }, { status: 500 });
  }
  const result = await handleHeartbeat({
    runnerId: auth.runnerId,
    body: auth.bodyJson(),
    repo,
  });
  return NextResponse.json(result.body, { status: result.status });
}
