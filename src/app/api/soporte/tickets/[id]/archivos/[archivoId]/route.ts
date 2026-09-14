import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { requireSoporteApi } from "@/lib/soporte/soporte-auth";
import {
  SOPORTE_BUCKET,
  errorInesperado,
  falla,
  ok,
  registrarHistorial,
  sinPermiso,
  tocarTicket,
} from "@/lib/soporte/servidor";

type Params = { params: Promise<{ id: string; archivoId: string }> };

/**
 * DELETE — quita un archivo del ticket.
 *
 * Se borra el objeto y la fila, pero el historial conserva que existió, quién
 * lo subió y quién lo quitó: la evidencia puede irse, la trazabilidad no.
 */
export async function DELETE(request: Request, { params }: Params) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  try {
    const { id, archivoId } = await params;
    const { data } = await auth.sb
      .from("soporte_ticket_archivos")
      .select("id, nombre, storage_path, subido_por, size_bytes")
      .eq("empresa_id", auth.empresaId)
      .eq("ticket_id", id)
      .eq("id", archivoId)
      .maybeSingle();
    const archivo = data as { id: string; nombre: string; storage_path: string; subido_por: string | null; size_bytes: number | null } | null;
    if (!archivo) return falla("Archivo no encontrado", 404);

    const { error } = await auth.sb.from("soporte_ticket_archivos").delete().eq("id", archivo.id).eq("empresa_id", auth.empresaId);
    if (error) return falla(error.message);
    await createServiceRoleClient().storage.from(SOPORTE_BUCKET).remove([archivo.storage_path]).catch(() => {});

    await registrarHistorial(auth.sb, {
      empresaId: auth.empresaId,
      ticketId: id,
      usuarioId: auth.usuarioId,
      eventos: [
        {
          tipo_evento: "archivo_eliminado",
          valor_anterior: archivo.nombre,
          metadata: { archivo_id: archivo.id, subido_por: archivo.subido_por, size: archivo.size_bytes },
        },
      ],
    });
    await tocarTicket(auth.sb, auth.empresaId, id, auth.usuarioId);
    return ok({ eliminado: true });
  } catch (e) {
    return errorInesperado(e);
  }
}
