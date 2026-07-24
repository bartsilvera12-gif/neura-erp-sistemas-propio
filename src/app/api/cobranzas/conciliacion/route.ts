import { NextRequest, NextResponse } from "next/server";
import { fetchDataSchemaForEmpresaId, createServiceRoleClientForEmpresa } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireCobranzasApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { listCobrosPendientes, registrarTransferencia, updateComprobantePath, ConciliacionError } from "@/lib/cobranzas/conciliacion-pg";
import {
  ALLOWED_COMPROBANTE_MIME, MAX_COMPROBANTE_BYTES, COBROS_COMPROBANTES_BUCKET,
  buildCobroComprobantePath, ensureCobrosComprobantesBucket, signCobroComprobante,
} from "@/lib/cobranzas/conciliacion-comprobante-storage";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const s = (v: unknown) => (v == null ? "" : String(v).trim());

/** GET — lista transferencias (por defecto pendientes). */
export async function GET(request: NextRequest) {
  const auth = await requireCobranzasApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  try {
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    const estado = request.nextUrl.searchParams.get("estado");
    const rows = await listCobrosPendientes(schema, auth.empresaId, { estado });
    return NextResponse.json(successResponse({ cobros: rows }));
  } catch (err) {
    console.error("[/api/cobranzas/conciliacion GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las transferencias."), { status: 500 });
  }
}

/** POST (multipart) — registra una transferencia pendiente + comprobante opcional. */
export async function POST(request: NextRequest) {
  const auth = await requireCobranzasApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  try {
    const schema = await fetchDataSchemaForEmpresaId(auth.empresaId);
    const form = await request.formData();
    const idem = s(form.get("idempotency_key"));

    if (!UUID_RE.test(s(form.get("factura_id")))) {
      return NextResponse.json(errorResponse("Seleccioná la factura."), { status: 400 });
    }

    const cobro = await registrarTransferencia(schema, auth.empresaId, {
      factura_id: s(form.get("factura_id")),
      monto: Number(form.get("monto")) || 0,
      fecha: s(form.get("fecha")) || new Date().toISOString().slice(0, 10),
      banco_origen: s(form.get("banco_origen")),
      titular: s(form.get("titular")),
      numero_operacion: s(form.get("numero_operacion")),
      idempotency_key: UUID_RE.test(idem) ? idem : null,
      created_by: auth.usuarioCatalogId ?? null,
    });

    // Comprobante opcional (se sube al registrar).
    let comprobanteUrl: string | null = null;
    const file = form.get("file");
    if (file instanceof File && file.size > 0) {
      if (!ALLOWED_COMPROBANTE_MIME.has(file.type)) {
        return NextResponse.json(successResponse({ cobro, warning: "Transferencia registrada, pero el comprobante tiene un formato no permitido (usá JPG, PNG, WebP o PDF)." }));
      }
      if (file.size > MAX_COMPROBANTE_BYTES) {
        return NextResponse.json(successResponse({ cobro, warning: `Transferencia registrada, pero el comprobante supera ${(MAX_COMPROBANTE_BYTES / 1024 / 1024).toFixed(0)} MB.` }));
      }
      const supabase = await createServiceRoleClientForEmpresa(auth.empresaId);
      await ensureCobrosComprobantesBucket(supabase);
      const path = buildCobroComprobantePath(auth.empresaId, cobro.id, file.type);
      const buf = Buffer.from(await file.arrayBuffer());
      const up = await supabase.storage.from(COBROS_COMPROBANTES_BUCKET).upload(path, buf, { contentType: file.type, upsert: true });
      if (!up.error) {
        await updateComprobantePath(schema, auth.empresaId, cobro.id, path, file.type);
        comprobanteUrl = await signCobroComprobante(supabase, path, 3600);
        cobro.comprobante_path = path;
      }
    }
    return NextResponse.json(successResponse({ cobro, comprobante_url: comprobanteUrl }));
  } catch (e) {
    if (e instanceof ConciliacionError) return NextResponse.json(errorResponse(e.message), { status: e.status });
    console.error("[/api/cobranzas/conciliacion POST]", e instanceof Error ? e.message : e);
    return NextResponse.json(errorResponse("No se pudo registrar la transferencia."), { status: 500 });
  }
}
