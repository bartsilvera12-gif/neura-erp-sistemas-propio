import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { requireCargaSoporteApi } from "@/lib/soporte/soporte-auth";
import { ARCHIVO_MAX_BYTES, mimeAceptado } from "@/lib/soporte/dominio";
import {
  SOPORTE_BUCKET,
  asegurarBucket,
  errorInesperado,
  falla,
  ok,
  pathArchivoTicket,
  sinPermiso,
  ticketDeEmpresa,
} from "@/lib/soporte/servidor";

type Params = { params: Promise<{ id: string }> };

/**
 * POST — URL firmada para subir UN archivo directo al Storage.
 *
 * Body: { nombre, mime_type, size }. Valida tipo y tamaño ANTES de firmar, y la
 * ruta la decide el servidor dentro de la carpeta del ticket: el navegador no
 * elige dónde escribe.
 */
export async function POST(request: Request, { params }: Params) {
  // Adjuntar evidencias al cargar el ticket: también los PM.
  const auth = await requireCargaSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  try {
    const { id } = await params;
    if (!(await ticketDeEmpresa(auth.sb, auth.empresaId, id, "id"))) return falla("Ticket no encontrado", 404);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const nombre = typeof body?.nombre === "string" ? body.nombre.trim() : "";
    const mime = typeof body?.mime_type === "string" ? body.mime_type : "";
    const size = Number(body?.size ?? 0);
    if (!nombre) return falla("Falta el nombre del archivo");
    if (!mimeAceptado(mime, nombre)) return falla(`"${nombre}": tipo de archivo no permitido`);
    if (!Number.isFinite(size) || size <= 0) return falla(`"${nombre}" está vacío`);
    if (size > ARCHIVO_MAX_BYTES) {
      return falla(`"${nombre}" supera los ${Math.round(ARCHIVO_MAX_BYTES / (1024 * 1024))} MB`);
    }

    await asegurarBucket();
    const path = pathArchivoTicket(auth.empresaId, id, nombre);
    const { data, error } = await createServiceRoleClient().storage.from(SOPORTE_BUCKET).createSignedUploadUrl(path);
    if (error || !data) return falla(error?.message ?? "No se pudo preparar la subida");

    return ok({ bucket: SOPORTE_BUCKET, path, token: data.token });
  } catch (e) {
    return errorInesperado(e);
  }
}
