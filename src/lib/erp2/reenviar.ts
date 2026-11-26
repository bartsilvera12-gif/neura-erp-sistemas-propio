/**
 * Reusa una ruta de Neura que ya hace lo que hace falta (importar / exportar Excel) y solo
 * cambia el sobre de la respuesta al formato del 2.0: `{ success, data, error }` → `{ ok, data }`.
 * Los archivos (Excel) pasan tal cual.
 */
import { NextResponse } from "next/server";

export async function reenviar(handler: (req: Request) => Promise<Response>, request: Request): Promise<Response> {
  const res = await handler(request);
  const tipo = res.headers.get("content-type") ?? "";
  if (!tipo.includes("application/json")) return res;
  const j = (await res.json().catch(() => null)) as { success?: boolean; data?: unknown; error?: string } | null;
  if (j?.success) return NextResponse.json({ ok: true, data: j.data }, { status: res.status });
  return NextResponse.json({ ok: false, error: { message: j?.error ?? "No se pudo completar." } }, { status: res.status >= 500 ? 400 : res.status || 400 });
}
