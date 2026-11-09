import { requirePersonalApi, ok, falla, errorInesperado, PERSONAL_BUCKET } from "@/lib/personal/servidor";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";

const UUID = /^[0-9a-f-]{36}$/i;
type Params = { params: Promise<{ id: string; docId: string }> };

/** DELETE /api/personal/:id/documentos/:docId — borra el documento (storage + fila). */
export async function DELETE(request: Request, { params }: Params) {
  const auth = await requirePersonalApi(request);
  if (!auth.ok) return auth.respuesta;
  const { empresaId, sb } = auth.ctx;
  try {
    const { id, docId } = await params;
    if (!UUID.test(id) || !UUID.test(docId)) return falla("Parámetros inválidos");
    const { data: doc } = await sb
      .from("personal_documentos")
      .select("id, storage_path")
      .eq("empresa_id", empresaId)
      .eq("usuario_id", id)
      .eq("id", docId)
      .maybeSingle();
    if (!doc) return falla("Documento no encontrado", 404);

    const { error } = await sb.from("personal_documentos").delete().eq("empresa_id", empresaId).eq("id", docId);
    if (error) return falla(error.message);
    await createServiceRoleClient().storage.from(PERSONAL_BUCKET).remove([(doc as { storage_path: string }).storage_path]).catch(() => {});
    return ok({ eliminado: true });
  } catch (e) {
    return errorInesperado(e);
  }
}
