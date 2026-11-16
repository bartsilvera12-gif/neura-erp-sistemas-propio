/**
 * NEURA QA CENTER — `GET /api/qa/admin/repos`
 *
 * Devuelve repos GitHub autorizados, consultando la API de GitHub con el
 * token server-side. NO hay whitelist fija: los repos salen de la cuenta
 * conectada, filtrados por `QA_GITHUB_ALLOWED_OWNERS` (opcional).
 *
 * Query:
 *   ?q=<substring>       búsqueda cliente→server (owner/name/etiqueta)
 *   ?page=1&per_page=50  paginación
 *
 * Gating: QA member. Nunca por el runner.
 * Nunca expone el token GitHub al frontend.
 */

import { NextResponse } from "next/server";
import { assertQaCenterAccess } from "@/lib/qa/auth";
import { listarReposDeGithub } from "@/lib/qa/github-repos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await assertQaCenterAccess(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? undefined;
  const page = parseInt(url.searchParams.get("page") ?? "1", 10) || 1;
  const per_page = parseInt(url.searchParams.get("per_page") ?? "50", 10) || 50;

  const out = await listarReposDeGithub({ q, page, per_page });
  if (!out.ok) {
    const status = out.code === "no_token" ? 503 : 502;
    return NextResponse.json(
      { error: out.message, code: out.code },
      { status, headers: { "Cache-Control": "no-store" } }
    );
  }

  const data = out.repos.map((r) => ({
    url: r.url,
    owner: r.owner,
    name: r.name,
    etiqueta: r.etiqueta,
    codebase: r.codebase,
    slug_sugerido: null,
    default_branch: r.default_branch,
    private: r.private,
    updated_at: r.updated_at,
  }));
  return NextResponse.json(
    {
      data,
      pagination: { page: out.page, per_page: out.per_page, has_more: out.has_more, total: out.total_estimado },
      source: out.source,
      allowed_owners: out.allowed_owners,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
