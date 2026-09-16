import { requireSoporteApi } from "@/lib/soporte/soporte-auth";
import { errorInesperado, falla, ok, sinPermiso, tocarTicket } from "@/lib/soporte/servidor";

type Params = { params: Promise<{ id: string; subId: string }> };

const UUID = /^[0-9a-f-]{36}$/i;

/** POST — comentario dentro de una subtarea (la revisión de QA). */
export async function POST(request: Request, { params }: Params) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  try {
    const { id, subId } = await params;
    if (!UUID.test(id) || !UUID.test(subId)) return falla("Subtarea no encontrada", 404);
    const { data: sub } = await auth.sb
      .from("soporte_subtareas")
      .select("id")
      .eq("empresa_id", auth.empresaId)
      .eq("ticket_id", id)
      .eq("id", subId)
      .maybeSingle();
    if (!sub) return falla("Subtarea no encontrada", 404);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const contenido = typeof body?.contenido === "string" ? body.contenido.trim().slice(0, 20_000) : "";
    if (!contenido) return falla("Escribí el comentario");

    const { data, error } = await auth.sb
      .from("soporte_ticket_comentarios")
      .insert({ empresa_id: auth.empresaId, ticket_id: id, subtarea_id: subId, usuario_id: auth.usuarioId, contenido })
      .select("id, created_at")
      .single();
    if (error || !data) return falla(error?.message ?? "No se pudo comentar");
    await tocarTicket(auth.sb, auth.empresaId, id, auth.usuarioId);
    return ok(data);
  } catch (e) {
    return errorInesperado(e);
  }
}
