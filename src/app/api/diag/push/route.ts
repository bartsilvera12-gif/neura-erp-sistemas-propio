/**
 * GET /api/diag/push — el mismo diagnóstico de `_diag/push`, publicado.
 *
 * En el App Router una carpeta que empieza con "_" es PRIVADA: no genera ruta. Por eso
 * `/api/_diag/push` siempre devolvió 404 y el diagnóstico nunca se pudo usar. Solo lee;
 * no manda pushes ni devuelve tokens completos.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export { GET } from "@/app/api/_diag/push/route";
