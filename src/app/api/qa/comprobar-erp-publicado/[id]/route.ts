/**
 * Prueba HTTP de solo lectura sobre Açaí House PUBLICADO.
 * No crea ventas, clientes ni comprobantes; no emplea credenciales.
 * Host fijo y rutas fijas: sin SSRF ni redirecciones a otros orígenes.
 */
import { NextResponse } from "next/server";
import { assertQaCenterAccess } from "@/lib/qa/auth";
import { buildQaRepo } from "@/lib/qa/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOST = "acaihouse.neura.com.py";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROUTES = ["/", "/login", "/dashboard"] as const;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await assertQaCenterAccess(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }
  const repo = buildQaRepo();
  if (!repo) return NextResponse.json({ error: "QA_DB_URL no configurada" }, { status: 503 });
  const project = await repo.getProject(id);
  if (!project || project.slug !== "acai-house") {
    return NextResponse.json({ error: "Este diagnóstico está habilitado solo para Açaí House" }, { status: 403 });
  }
  let configured: URL;
  try { configured = new URL(project.target_base_url); }
  catch { return NextResponse.json({ error: "Configurá la URL pública de Açaí House" }, { status: 400 }); }
  if (configured.protocol !== "https:" || configured.hostname !== HOST || configured.port || configured.username || configured.password) {
    return NextResponse.json({ error: "La URL debe ser https://acaihouse.neura.com.py/" }, { status: 400 });
  }

  const results = [];
  for (const route of ROUTES) {
    const started = Date.now();
    try {
      const response = await fetch(`https://${HOST}${route}`, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(12000),
        headers: { "Accept": "text/html", "User-Agent": "Neura-QA-Center-read-only/1.0" },
      });
      const location = response.headers.get("location");
      const redirectHost = location
        ? new URL(location, `https://${HOST}`).hostname : null;
      const redirectSafe = redirectHost === null || redirectHost === HOST;
      const accepted = route === "/"
        ? response.status >= 200 && response.status < 400 && redirectSafe
        : response.status >= 200 && response.status < 400 && redirectSafe;
      results.push({
        route, passed: accepted, status: response.status,
        redirect: redirectSafe ? location : "[redireccion externa bloqueada]",
        duration_ms: Date.now() - started,
        detail: redirectSafe ? (accepted ? "HTTP correcto" : "Respuesta HTTP inesperada") : "Redirección hacia otro dominio",
      });
    } catch (error) {
      results.push({
        route, passed: false, status: null, redirect: null,
        duration_ms: Date.now() - started,
        detail: error instanceof Error ? error.message : "Error de red",
      });
    }
  }
  return NextResponse.json({
    project: project.slug, target: `https://${HOST}/`,
    mode: "produccion_lectura_http",
    warning: "Verificación HTTP real; no prueba autenticación, ventas ni inventario.",
    passed: results.filter((r) => r.passed).length,
    total: results.length, results,
  }, { headers: { "Cache-Control": "no-store" } });
}
