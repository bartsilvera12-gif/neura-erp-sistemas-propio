import { requireSoporteApi } from "@/lib/soporte/soporte-auth";
import {
  errorInesperado,
  falla,
  ok,
  personasPorId,
  registrarHistorial,
  sinPermiso,
  ticketDeEmpresa,
  tocarTicket,
} from "@/lib/soporte/servidor";

type Params = { params: Promise<{ id: string }> };

/** GET — la conversación del ticket, en orden cronológico. */
export async function GET(request: Request, { params }: Params) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  try {
    const { id } = await params;
    if (!(await ticketDeEmpresa(auth.sb, auth.empresaId, id, "id"))) return falla("Ticket no encontrado", 404);

    const { data, error } = await auth.sb
      .from("soporte_ticket_comentarios")
      .select("id, usuario_id, contenido, es_rechazo_qa, created_at")
      .eq("empresa_id", auth.empresaId)
      .eq("ticket_id", id)
      .order("created_at", { ascending: true });
    if (error) return falla(error.message);

    const filas = (data ?? []) as { id: string; usuario_id: string | null; contenido: string; es_rechazo_qa: boolean; created_at: string }[];
    const personas = await personasPorId(filas.map((c) => c.usuario_id));

    // Archivos adjuntados junto a cada comentario.
    const ids = filas.map((c) => c.id);
    const adjuntos = new Map<string, { id: string; nombre: string }[]>();
    if (ids.length) {
      const { data: arch } = await auth.sb
        .from("soporte_ticket_archivos")
        .select("id, nombre, comentario_id")
        .eq("ticket_id", id)
        .in("comentario_id", ids);
      for (const a of (arch ?? []) as { id: string; nombre: string; comentario_id: string }[]) {
        const lista = adjuntos.get(a.comentario_id) ?? [];
        lista.push({ id: a.id, nombre: a.nombre });
        adjuntos.set(a.comentario_id, lista);
      }
    }

    return ok(
      filas.map((c) => ({
        ...c,
        autor: c.usuario_id ? (personas.get(c.usuario_id) ?? null) : null,
        adjuntos: adjuntos.get(c.id) ?? [],
      }))
    );
  } catch (e) {
    return errorInesperado(e);
  }
}

/**
 * POST — agrega un comentario. Los comentarios son mensajes humanos; el hecho
 * de que alguien comentó queda además en el historial, que es la auditoría.
 */
export async function POST(request: Request, { params }: Params) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  try {
    const { id } = await params;
    if (!(await ticketDeEmpresa(auth.sb, auth.empresaId, id, "id"))) return falla("Ticket no encontrado", 404);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const contenido = typeof body?.contenido === "string" ? body.contenido.trim().slice(0, 20_000) : "";
    if (!contenido) return falla("Escribí el comentario");

    const { data, error } = await auth.sb
      .from("soporte_ticket_comentarios")
      .insert({ empresa_id: auth.empresaId, ticket_id: id, usuario_id: auth.usuarioId, contenido })
      .select("id, created_at")
      .single();
    if (error || !data) return falla(error?.message ?? "No se pudo comentar");

    await registrarHistorial(auth.sb, {
      empresaId: auth.empresaId,
      ticketId: id,
      usuarioId: auth.usuarioId,
      eventos: [{ tipo_evento: "comentario", metadata: { comentario_id: data.id } }],
    });
    await tocarTicket(auth.sb, auth.empresaId, id, auth.usuarioId);
    return ok(data);
  } catch (e) {
    return errorInesperado(e);
  }
}
