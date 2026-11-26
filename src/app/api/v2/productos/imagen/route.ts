import { randomUUID } from "crypto";
import { ctxV2, ErrorV2, fallo, ok } from "@/lib/erp2/server";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import {
  ALLOWED_IMAGE_EXT,
  ALLOWED_IMAGE_MIME,
  ensureProductosImagenesBucket,
  MAX_IMAGE_BYTES,
  PRODUCTOS_IMAGENES_BUCKET,
} from "@/lib/inventario/imagen-storage";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

export const runtime = "nodejs";

/**
 * Sube la foto de un producto (el formulario del 2.0 la sube antes de guardar el producto).
 * Va al bucket privado de siempre de Neura y devuelve un enlace firmado de larga duración.
 */
export async function POST(request: Request) {
  try {
    const c = await ctxV2(request, "inventario");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ErrorV2("Elegí una imagen");
    if (!ALLOWED_IMAGE_MIME.has(file.type)) throw new ErrorV2("La imagen tiene que ser JPG, PNG o WEBP");
    if (file.size > MAX_IMAGE_BYTES) throw new ErrorV2("La imagen no puede superar 5 MB");
    const sb = createServiceRoleClient() as unknown as AppSupabaseClient;
    await ensureProductosImagenesBucket(sb);
    const path = `${c.empresaId}/subidas/${randomUUID()}.${ALLOWED_IMAGE_EXT[file.type]}`;
    const { error } = await sb.storage.from(PRODUCTOS_IMAGENES_BUCKET).upload(path, file, { contentType: file.type });
    if (error) throw new ErrorV2("No se pudo subir la imagen");
    const { data } = await sb.storage.from(PRODUCTOS_IMAGENES_BUCKET).createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
    if (!data?.signedUrl) throw new ErrorV2("No se pudo subir la imagen");
    return ok({ url: data.signedUrl }, 201);
  } catch (err) {
    return fallo(err, "POST /productos/imagen");
  }
}
