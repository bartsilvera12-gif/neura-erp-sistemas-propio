import { requirePersonalApi, ok, falla, errorInesperado, ensurePersonalBucket, PERSONAL_BUCKET, URL_FIRMADA_TTL } from "@/lib/personal/servidor";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import type { DocumentoDTO } from "@/lib/personal/types";

const UUID = /^[0-9a-f-]{36}$/i;
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
type Params = { params: Promise<{ id: string }> };

/** GET /api/personal/:id/documentos — documentos del empleado con URL firmada. */
export async function GET(request: Request, { params }: Params) {
  const auth = await requirePersonalApi(request);
  if (!auth.ok) return auth.respuesta;
  const { empresaId, sb } = auth.ctx;
  try {
    const { id } = await params;
    if (!UUID.test(id)) return falla("Funcionario inválido");
    const { data, error } = await sb
      .from("personal_documentos")
      .select("id, nombre, mime_type, size_bytes, storage_path, created_at")
      .eq("empresa_id", empresaId)
      .eq("usuario_id", id)
      .order("created_at", { ascending: false });
    if (error) return falla(error.message);
    const filas = (data ?? []) as { id: string; nombre: string; mime_type: string | null; size_bytes: number | null; storage_path: string; created_at: string }[];
    const storage = createServiceRoleClient().storage.from(PERSONAL_BUCKET);
    const documentos: DocumentoDTO[] = await Promise.all(
      filas.map(async (d) => {
        const { data: firmada } = await storage.createSignedUrl(d.storage_path, URL_FIRMADA_TTL);
        return { id: d.id, nombre: d.nombre, mime_type: d.mime_type, size_bytes: d.size_bytes, url: firmada?.signedUrl ?? null, created_at: d.created_at };
      })
    );
    return ok({ documentos });
  } catch (e) {
    return errorInesperado(e);
  }
}

/** POST /api/personal/:id/documentos — sube un documento (multipart form-data, campo `file`). */
export async function POST(request: Request, { params }: Params) {
  const auth = await requirePersonalApi(request);
  if (!auth.ok) return auth.respuesta;
  const { empresaId, usuarioId, sb } = auth.ctx;
  try {
    const { id } = await params;
    if (!UUID.test(id)) return falla("Funcionario inválido");
    const { data: empleado } = await sb.from("usuarios").select("id").eq("empresa_id", empresaId).eq("id", id).maybeSingle();
    if (!empleado) return falla("Funcionario no encontrado", 404);

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size === 0) return falla("Adjuntá un archivo");
    if (file.size > MAX_BYTES) return falla("El archivo supera el máximo de 15 MB");
    const nombre = (String(form?.get("nombre") ?? file.name) || file.name).trim().slice(0, 200) || "documento";

    await ensurePersonalBucket();
    const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80) || "archivo";
    const path = `${empresaId}/${id}/${crypto.randomUUID()}-${safe}`;
    const storage = createServiceRoleClient().storage.from(PERSONAL_BUCKET);
    const buf = Buffer.from(await file.arrayBuffer());
    const up = await storage.upload(path, buf, { contentType: file.type || "application/octet-stream", upsert: false });
    if (up.error) return falla(`No se pudo subir: ${up.error.message}`, 500);

    const { data, error } = await sb
      .from("personal_documentos")
      .insert({
        empresa_id: empresaId,
        usuario_id: id,
        nombre,
        storage_bucket: PERSONAL_BUCKET,
        storage_path: path,
        mime_type: file.type || null,
        size_bytes: file.size,
        subido_por: usuarioId,
      })
      .select("id")
      .single();
    if (error || !data) {
      await storage.remove([path]).catch(() => {});
      return falla(error?.message ?? "No se pudo registrar el documento", 500);
    }
    return ok({ id: (data as { id: string }).id });
  } catch (e) {
    return errorInesperado(e);
  }
}
