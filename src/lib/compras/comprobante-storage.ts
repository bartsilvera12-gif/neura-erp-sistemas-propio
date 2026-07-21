/**
 * Storage helpers para el comprobante (foto/PDF) de una compra.
 *
 * Bucket: `compras-comprobantes` (privado).
 * Path:   `{empresa_id}/{compra_id}/comprobante.{ext}`
 *
 * Aislamiento por tenant: el primer segmento del path es `empresa_id` y los
 * endpoints siempre validan el `empresa_id` del usuario antes de leer/escribir.
 */
import type { AppSupabaseClient } from "@/lib/supabase/schema";

export const COMPRAS_COMPROBANTES_BUCKET = "compras-comprobantes";

export const ALLOWED_COMPROBANTE_MIME = new Set([
  "image/jpeg", "image/png", "image/webp", "application/pdf",
]);
export const ALLOWED_COMPROBANTE_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};
export const MAX_COMPROBANTE_BYTES = 8 * 1024 * 1024; // 8 MB

let bucketEnsured = false;

/** Crea el bucket privado si no existe. Idempotente (cachea en memoria del proceso). */
export async function ensureComprasComprobantesBucket(supabase: AppSupabaseClient): Promise<void> {
  if (bucketEnsured) return;
  try {
    const { data: existing } = await supabase.storage.getBucket(COMPRAS_COMPROBANTES_BUCKET);
    if (existing) { bucketEnsured = true; return; }
  } catch {
    // fallthrough — intentar crear
  }
  const { error: createErr } = await supabase.storage.createBucket(COMPRAS_COMPROBANTES_BUCKET, {
    public: false,
    fileSizeLimit: MAX_COMPROBANTE_BYTES,
    allowedMimeTypes: [...ALLOWED_COMPROBANTE_MIME],
  });
  if (createErr && !/already exists|duplicate/i.test(createErr.message)) {
    throw new Error(`No se pudo crear el bucket: ${createErr.message}`);
  }
  bucketEnsured = true;
}

export function buildComprobantePath(empresaId: string, compraId: string, mime: string): string {
  const ext = ALLOWED_COMPROBANTE_EXT[mime] ?? "bin";
  return `${empresaId}/${compraId}/comprobante.${ext}`;
}

/** URL firmada para visualizar/descargar el comprobante. TTL por defecto 1h. */
export async function signComprobante(
  supabase: AppSupabaseClient,
  path: string | null | undefined,
  ttlSeconds = 3600
): Promise<string | null> {
  if (!path) return null;
  try {
    const { data, error } = await supabase.storage
      .from(COMPRAS_COMPROBANTES_BUCKET)
      .createSignedUrl(path, ttlSeconds);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

/** Valida que el path pertenezca a la empresa (primer segmento). */
export function comprobantePathBelongsToEmpresa(path: string | null | undefined, empresaId: string): boolean {
  if (!path) return false;
  return path.split("/")[0] === empresaId;
}
