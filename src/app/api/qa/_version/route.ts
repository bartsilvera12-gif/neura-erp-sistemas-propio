/**
 * NEURA QA CENTER — `GET /api/qa/_version`
 *
 * Endpoint público, read-only, SIN datos sensibles. Sirve para verificar
 * desde afuera qué build del backend está respondiendo tráfico.
 * El "marker" es un string literal de código: si el valor que devuelve el
 * server NO coincide con el commit esperado, el deploy no reemplazó el
 * container o Coolify sirvió una imagen cacheada.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUILD_MARKER = "v4-tipo-proyecto-erp-web-2026-11-27";

export async function GET() {
  return NextResponse.json(
    { marker: BUILD_MARKER, now: new Date().toISOString() },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
