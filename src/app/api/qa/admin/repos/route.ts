/**
 * NEURA QA CENTER — `GET /api/qa/admin/repos`
 *
 * Devuelve la lista de repositorios GitHub AUTORIZADOS para asociar a un
 * proyecto QA. No consulta la GitHub API ni enumera repos del usuario:
 * la whitelist está codificada en `src/lib/qa/repos-autorizados.ts`.
 *
 * Gating: QA member. Nunca por el runner.
 */

import { NextResponse } from "next/server";
import { assertQaCenterAccess } from "@/lib/qa/auth";
import { listarReposAutorizados } from "@/lib/qa/repos-autorizados";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await assertQaCenterAccess(request);
  if (!auth.ok) return auth.response;

  const repos = listarReposAutorizados().map((r) => ({
    url: r.url,
    owner: r.owner,
    name: r.name,
    etiqueta: r.etiqueta,
    codebase: r.codebase,
    slug_sugerido: r.slug_sugerido ?? null,
    default_branch: r.default_branch ?? "main",
  }));

  return NextResponse.json({ data: repos }, { status: 200, headers: { "Cache-Control": "no-store" } });
}
