import { NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api/response";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { requireAyudaAdminAccess } from "@/lib/ayuda/ayuda-auth";
import { AYUDA_BUCKET } from "@/lib/ayuda/ayuda-adjuntos-storage";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; adjuntoId: string }> };

/** Elimina un adjunto (registro + objeto en storage). Admin-only. */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const auth = await requireAyudaAdminAccess(request);
    if (!auth.ok) {
      return NextResponse.json(errorResponse(auth.message), { status: auth.status });
    }
    const { id, adjuntoId } = await context.params;

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const { data, error } = await sb
      .from("ayuda_articulo_adjuntos")
      .select("id, storage_bucket, storage_path")
      .eq("empresa_id", auth.empresaId)
      .eq("articulo_id", id)
      .eq("id", adjuntoId)
      .maybeSingle();
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    if (!data) return NextResponse.json(errorResponse("Adjunto no encontrado"), { status: 404 });

    const adjunto = data as { storage_bucket: string | null; storage_path: string };

    const { error: eDel } = await sb
      .from("ayuda_articulo_adjuntos")
      .delete()
      .eq("empresa_id", auth.empresaId)
      .eq("articulo_id", id)
      .eq("id", adjuntoId);
    if (eDel) return NextResponse.json(errorResponse(eDel.message), { status: 400 });

    const bucket = adjunto.storage_bucket || AYUDA_BUCKET;
    await sb.storage.from(bucket).remove([adjunto.storage_path]).catch(() => {});

    return NextResponse.json(successResponse({ id: adjuntoId }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "No se pudo eliminar el documento";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
