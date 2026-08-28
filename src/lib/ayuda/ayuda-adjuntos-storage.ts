import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Bucket privado (global del proyecto Supabase) para los documentos de la Ayuda.
 * Aislamiento por empresa/artículo vía path: `${empresaId}/${articuloId}/...`.
 * El acceso se sirve siempre con signed URLs de corta duración.
 */
export const AYUDA_BUCKET = "ayuda";

/** Límite por archivo (contrato en PDF, planillas, instructivos, imágenes…). */
export const AYUDA_ADJUNTO_MAX_BYTES = 25 * 1024 * 1024; // 25 MB

/** Vigencia de los signed URL de vista previa / descarga. */
export const AYUDA_SIGNED_URL_TTL = 60 * 10; // 10 minutos

/** Crea el bucket privado si todavía no existe (idempotente). */
export async function ensureAyudaBucket(sb: AppSupabaseClient): Promise<void> {
  const { data, error } = await sb.storage.listBuckets();
  if (error) throw new Error(error.message);
  if ((data ?? []).some((b) => b.name === AYUDA_BUCKET)) return;
  const { error: createErr } = await sb.storage.createBucket(AYUDA_BUCKET, {
    public: false,
    fileSizeLimit: AYUDA_ADJUNTO_MAX_BYTES,
  });
  if (createErr && !createErr.message.toLowerCase().includes("already exists")) {
    throw new Error(createErr.message);
  }
}

/** Normaliza el nombre original para el storage path (sin romper unicidad). */
function sanitizeFileNameForPath(name: string): string {
  const trimmed = name.trim() || "documento";
  const dot = trimmed.lastIndexOf(".");
  const base = dot > 0 ? trimmed.slice(0, dot) : trimmed;
  const ext = dot > 0 ? trimmed.slice(dot + 1) : "";
  const safeBase = base
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80)
    .toLowerCase();
  const safeExt = ext.replace(/[^\w]+/g, "").slice(0, 12).toLowerCase();
  const stem = safeBase || "documento";
  return safeExt ? `${stem}.${safeExt}` : stem;
}

/** Path de storage namespaced por empresa + artículo, con prefijo aleatorio. */
export function buildAyudaAdjuntoPath(
  empresaId: string,
  articuloId: string,
  originalName: string
): string {
  const unique = crypto.randomUUID();
  return `${empresaId}/${articuloId}/${unique}-${sanitizeFileNameForPath(originalName)}`;
}
