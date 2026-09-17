import { requireSoporteApi } from "@/lib/soporte/soporte-auth";
import { errorInesperado, falla, ok, personasPorId, sinPermiso, ticketDeEmpresa } from "@/lib/soporte/servidor";
import { SUBTAREA_CAMPOS, type SubtareaFila } from "@/lib/soporte/subtareas";

type Params = { params: Promise<{ id: string }> };

/** GET — subtareas del ticket, cada una con su conversación. */
export async function GET(request: Request, { params }: Params) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  try {
    const { id } = await params;
    if (!(await ticketDeEmpresa(auth.sb, auth.empresaId, id, "id"))) return falla("Ticket no encontrado", 404);

    const [{ data: subs, error }, { data: coms }] = await Promise.all([
      auth.sb.from("soporte_subtareas").select(SUBTAREA_CAMPOS).eq("empresa_id", auth.empresaId).eq("ticket_id", id).order("numero"),
      auth.sb
        .from("soporte_ticket_comentarios")
        .select("id, subtarea_id, usuario_id, contenido, es_rechazo_qa, created_at")
        .eq("empresa_id", auth.empresaId)
        .eq("ticket_id", id)
        .not("subtarea_id", "is", null)
        .order("created_at", { ascending: true }),
    ]);
    if (error) return falla(error.message);

    const filas = (subs ?? []) as SubtareaFila[];
    const comentarios = (coms ?? []) as { id: string; subtarea_id: string; usuario_id: string | null; contenido: string; es_rechazo_qa: boolean; created_at: string }[];
    const personas = await personasPorId([...filas.map((s) => s.asignado_id), ...comentarios.map((c) => c.usuario_id)]);

    // Archivos adjuntados junto a cada comentario de la revisión.
    const adjuntos = new Map<string, { id: string; nombre: string }[]>();
    if (comentarios.length) {
      const { data: arch } = await auth.sb
        .from("soporte_ticket_archivos")
        .select("id, nombre, comentario_id")
        .eq("ticket_id", id)
        .in("comentario_id", comentarios.map((c) => c.id));
      for (const a of (arch ?? []) as { id: string; nombre: string; comentario_id: string }[]) {
        adjuntos.set(a.comentario_id, [...(adjuntos.get(a.comentario_id) ?? []), { id: a.id, nombre: a.nombre }]);
      }
    }

    return ok(
      filas.map((s) => ({
        ...s,
        asignado: s.asignado_id ? (personas.get(s.asignado_id) ?? null) : null,
        comentarios: comentarios
          .filter((c) => c.subtarea_id === s.id)
          .map((c) => ({ ...c, autor: c.usuario_id ? (personas.get(c.usuario_id) ?? null) : null, adjuntos: adjuntos.get(c.id) ?? [] })),
      }))
    );
  } catch (e) {
    return errorInesperado(e);
  }
}
