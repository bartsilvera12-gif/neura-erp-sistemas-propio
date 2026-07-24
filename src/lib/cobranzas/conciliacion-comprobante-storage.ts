/**
 * Storage del comprobante (foto/PDF) de una transferencia en conciliación.
 * Bucket privado `cobros-comprobantes`, path `{empresa_id}/{cobro_id}/comprobante.{ext}`.
 * Mismo patrón que compras/comprobante-storage.
 */
import type { AppSupabaseClient } from "@/lib/supabase/schema";

export const COBROS_COMPROBANTES_BUCKET = "cobros-comprobantes";
export const ALLOWED_COMPROBANTE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
export const ALLOWED_COMPROBANTE_EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf",
};
export const MAX_COMPROBANTE_BYTES = 8 * 1024 * 1024; // 8 MB

let bucketEnsured = false;

export async function ensureCobrosComprobantesBucket(supabase: AppSupabaseClient): Promise<void> {
  if (bucketEnsured) return;
  try {
    const { data: existing } = await supabase.storage.getBucket(COBROS_COMPROBANTES_BUCKET);
    if (existing) { bucketEnsured = true; return; }
  } catch { /* intentar crear */ }
  const { error } = await supabase.storage.createBucket(COBROS_COMPROBANTES_BUCKET, {
    public: false, fileSizeLimit: MAX_COMPROBANTE_BYTES, allowedMimeTypes: [...ALLOWED_COMPROBANTE_MIME],
  });
  if (error && !/already exists|duplicate/i.test(error.message)) {
    throw new Error(`No se pudo crear el bucket: ${error.message}`);
  }
  bucketEnsured = true;
}

export function buildCobroComprobantePath(empresaId: string, cobroId: string, mime: string): string {
  const ext = ALLOWED_COMPROBANTE_EXT[mime] ?? "bin";
  return `${empresaId}/${cobroId}/comprobante.${ext}`;
}

export async function signCobroComprobante(supabase: AppSupabaseClient, path: string | null | undefined, ttl = 3600): Promise<string | null> {
  if (!path) return null;
  try {
    const { data, error } = await supabase.storage.from(COBROS_COMPROBANTES_BUCKET).createSignedUrl(path, ttl);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch { return null; }
}

export function comprobantePathBelongsToEmpresa(path: string | null | undefined, empresaId: string): boolean {
  if (!path) return false;
  return path.split("/")[0] === empresaId;
}
