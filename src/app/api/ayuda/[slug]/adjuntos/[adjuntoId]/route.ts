import { NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api/response";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { requireAyudaApiAccess } from "@/lib/ayuda/ayuda-auth";
import { listArticulos, puedeVerArticulo } from "@/lib/ayuda/ayuda";
import { AYUDA_BUCKET, AYUDA_SIGNED_URL_TTL } from "@/lib/ayuda/ayuda-adjuntos-storage";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ slug: string; adjuntoId: string }> };

/**
 * Signed URL de corta duración para ver (inline) o descargar (`?download=1`) un
 * adjunto. Cualquier usuario con sesión que pueda ver el artículo puede abrirlo.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const auth = await requireAyudaApiAccess(request);
    if (!auth.ok) {
      return NextResponse.json(errorResponse(auth.message), { status: auth.status });
    }
    const { slug, adjuntoId } = await context.params;
    const download = new URL(request.url).searchParams.get("download") === "1";

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const articulo = (await listArticulos(sb, auth.empresaId)).find((a) => a.slug === slug);
    if (!articulo || !puedeVerArticulo(articulo, auth.rol, auth.esAdmin)) {
      return NextResponse.json(errorResponse("Artículo no encontrado"), { status: 404 });
    }

    const { data, error } = await sb
      .from("ayuda_articulo_adjuntos")
      .select("storage_bucket, storage_path, nombre")
      .eq("empresa_id", auth.empresaId)
      .eq("articulo_id", articulo.id)
      .eq("id", adjuntoId)
      .maybeSingle();
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    if (!data) return NextResponse.json(errorResponse("Documento no encontrado"), { status: 404 });

    const adjunto = data as { storage_bucket: string | null; storage_path: string; nombre: string };
    const bucket = adjunto.storage_bucket || AYUDA_BUCKET;
    const { data: signed, error: eSign } = await sb.storage
      .from(bucket)
      .createSignedUrl(
        adjunto.storage_path,
        AYUDA_SIGNED_URL_TTL,
        download ? { download: adjunto.nombre } : undefined
      );
    if (eSign) return NextResponse.json(errorResponse(eSign.message), { status: 400 });
    if (!signed?.signedUrl) {
      return NextResponse.json(errorResponse("No se pudo generar el enlace"), { status: 400 });
    }

    return NextResponse.json(successResponse({ url: signed.signedUrl, nombre: adjunto.nombre }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "No se pudo abrir el documento";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
