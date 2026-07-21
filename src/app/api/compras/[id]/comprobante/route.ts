import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getCompraById, updateCompraDocumento } from "@/lib/compras/server/compras-pg";
import {
  ALLOWED_COMPROBANTE_MIME, MAX_COMPROBANTE_BYTES, COMPRAS_COMPROBANTES_BUCKET,
  buildComprobantePath, ensureComprasComprobantesBucket, comprobantePathBelongsToEmpresa, signComprobante,
} from "@/lib/compras/comprobante-storage";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** GET — URL firmada del comprobante (TTL 1h). */
export async function GET(request: NextRequest, ctxParams: RouteContext) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const schema = await fetchDataSchemaForEmpresaId(empresaId);
    const compra = await getCompraById(schema, empresaId, id);
    if (!compra) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    const url = compra.documento_path ? await signComprobante(ctx.supabase, compra.documento_path, 3600) : null;
    return NextResponse.json(successResponse({ documento_path: compra.documento_path, documento_mime: compra.documento_mime, documento_url: url }));
  } catch (err) {
    console.error("[/api/compras/[id]/comprobante GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo obtener el comprobante."), { status: 500 });
  }
}

/** POST — sube la foto/PDF de la factura (multipart, campo 'file'). */
export async function POST(request: NextRequest, ctxParams: RouteContext) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const schema = await fetchDataSchemaForEmpresaId(empresaId);

    const compra = await getCompraById(schema, empresaId, id);
    if (!compra) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(errorResponse("Falta el archivo (campo 'file')."), { status: 400 });
    }
    if (!ALLOWED_COMPROBANTE_MIME.has(file.type)) {
      return NextResponse.json(errorResponse("Formato no permitido. Usá JPG, PNG, WebP o PDF."), { status: 400 });
    }
    if (file.size > MAX_COMPROBANTE_BYTES) {
      const mb = (MAX_COMPROBANTE_BYTES / 1024 / 1024).toFixed(0);
      return NextResponse.json(errorResponse(`Archivo demasiado grande (máx. ${mb} MB).`), { status: 413 });
    }

    await ensureComprasComprobantesBucket(ctx.supabase);

    // Borrar anterior si pertenece a la empresa y cambia de extensión.
    if (compra.documento_path && comprobantePathBelongsToEmpresa(compra.documento_path, empresaId)) {
      await ctx.supabase.storage.from(COMPRAS_COMPROBANTES_BUCKET).remove([compra.documento_path]);
    }

    const path = buildComprobantePath(empresaId, id, file.type);
    const buf = Buffer.from(await file.arrayBuffer());
    const up = await ctx.supabase.storage
      .from(COMPRAS_COMPROBANTES_BUCKET)
      .upload(path, buf, { contentType: file.type, upsert: true });
    if (up.error) {
      console.error("[/api/compras/[id]/comprobante POST] upload", { schema, empresaId, id, message: up.error.message });
      return NextResponse.json(errorResponse("No se pudo subir el comprobante."), { status: 500 });
    }

    await updateCompraDocumento(schema, empresaId, id, path, file.type);
    const url = await signComprobante(ctx.supabase, path, 3600);
    return NextResponse.json(successResponse({ documento_path: path, documento_mime: file.type, documento_url: url }));
  } catch (err) {
    console.error("[/api/compras/[id]/comprobante POST]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo subir el comprobante."), { status: 500 });
  }
}

/** DELETE — quita el comprobante adjunto. */
export async function DELETE(request: NextRequest, ctxParams: RouteContext) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const schema = await fetchDataSchemaForEmpresaId(empresaId);
    const compra = await getCompraById(schema, empresaId, id);
    if (!compra) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    if (compra.documento_path && comprobantePathBelongsToEmpresa(compra.documento_path, empresaId)) {
      await ctx.supabase.storage.from(COMPRAS_COMPROBANTES_BUCKET).remove([compra.documento_path]);
    }
    await updateCompraDocumento(schema, empresaId, id, null, null);
    return NextResponse.json(successResponse({ documento_path: null }));
  } catch (err) {
    console.error("[/api/compras/[id]/comprobante DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo quitar el comprobante."), { status: 500 });
  }
}
