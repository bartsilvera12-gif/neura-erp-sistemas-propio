import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { requireSoporteApi } from "@/lib/soporte/soporte-auth";
import {
  SOPORTE_BUCKET,
  SOPORTE_URL_FIRMADA_TTL,
  errorInesperado,
  falla,
  ok,
  personasPorId,
  registrarHistorial,
  sinPermiso,
  ticketDeEmpresa,
  tocarTicket,
} from "@/lib/soporte/servidor";
import { avisarSeguidoresMovilesSoporte } from "@/lib/soporte/notificar-seguidores-moviles";
import { avisarSoporte } from "@/lib/soporte/subtareas";

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
      .select("id, usuario_id, contenido, es_rechazo_qa, created_at, editado_at, parent_id")
      .eq("empresa_id", auth.empresaId)
      .eq("ticket_id", id)
      .is("subtarea_id", null)
      .order("created_at", { ascending: true });
    if (error) return falla(error.message);

    const filas = (data ?? []) as { id: string; usuario_id: string | null; contenido: string; es_rechazo_qa: boolean; created_at: string; editado_at: string | null; parent_id: string | null }[];
    const personas = await personasPorId(filas.map((c) => c.usuario_id));

    // Archivos adjuntados junto a cada comentario, con URL firmada para la vista
    // previa: las imágenes se muestran bajo el texto del comentario.
    const ids = filas.map((c) => c.id);
    const adjuntos = new Map<string, { id: string; nombre: string; mime_type: string | null; url: string | null }[]>();
    if (ids.length) {
      const { data: arch } = await auth.sb
        .from("soporte_ticket_archivos")
        .select("id, nombre, mime_type, storage_path, comentario_id")
        .eq("ticket_id", id)
        .in("comentario_id", ids);
      const storage = createServiceRoleClient().storage.from(SOPORTE_BUCKET);
      const filasArch = (arch ?? []) as { id: string; nombre: string; mime_type: string | null; storage_path: string; comentario_id: string }[];
      await Promise.all(
        filasArch.map(async (a) => {
          const { data: firmada } = await storage.createSignedUrl(a.storage_path, SOPORTE_URL_FIRMADA_TTL);
          const lista = adjuntos.get(a.comentario_id) ?? [];
          lista.push({ id: a.id, nombre: a.nombre, mime_type: a.mime_type, url: firmada?.signedUrl ?? null });
          adjuntos.set(a.comentario_id, lista);
        })
      );
    }

    // El autor puede editar/eliminar el suyo. El permiso real se revalida en el
    // PATCH/DELETE; esto solo decide si la UI muestra los botones.
    const armar = (c: (typeof filas)[number]) => ({
      id: c.id,
      contenido: c.contenido,
      es_rechazo_qa: c.es_rechazo_qa,
      created_at: c.created_at,
      editado_at: c.editado_at,
      parent_id: c.parent_id,
      autor: c.usuario_id ? (personas.get(c.usuario_id) ?? null) : null,
      adjuntos: adjuntos.get(c.id) ?? [],
      mio: c.usuario_id != null && c.usuario_id === auth.usuarioId,
    });

    // Hilo de 1 nivel: los top-level (parent_id null) llevan sus respuestas
    // (subcomentarios) anidadas, en orden cronológico.
    const respuestasPorPadre = new Map<string, ReturnType<typeof armar>[]>();
    for (const c of filas) {
      if (c.parent_id == null) continue;
      const lista = respuestasPorPadre.get(c.parent_id) ?? [];
      lista.push(armar(c));
      respuestasPorPadre.set(c.parent_id, lista);
    }

    return ok(
      filas
        .filter((c) => c.parent_id == null)
        .map((c) => ({ ...armar(c), respuestas: respuestasPorPadre.get(c.id) ?? [] }))
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

    // Subcomentario: respuesta a un comentario top-level del mismo ticket.
    // Hilo de 1 nivel: no se responde a una respuesta.
    const parentId = typeof body?.parent_id === "string" && body.parent_id ? body.parent_id : null;
    if (parentId) {
      const { data: padre } = await auth.sb
        .from("soporte_ticket_comentarios")
        .select("id, parent_id")
        .eq("empresa_id", auth.empresaId)
        .eq("ticket_id", id)
        .eq("id", parentId)
        .maybeSingle();
      if (!padre) return falla("El comentario que querés responder no existe en este ticket", 404);
      if ((padre as { parent_id: string | null }).parent_id != null)
        return falla("No se puede responder a una respuesta");
    }

    const { data, error } = await auth.sb
      .from("soporte_ticket_comentarios")
      .insert({ empresa_id: auth.empresaId, ticket_id: id, usuario_id: auth.usuarioId, contenido, parent_id: parentId })
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
    // Push al "seguimiento móvil especial" (Karen, Milagros). Excluye al autor para que
    // no se auto-notifique. Respeta la pref 'soporte'.
    const { data: tk } = await auth.sb
      .from("soporte_tickets")
      .select("numero, asunto, responsable_id")
      .eq("empresa_id", auth.empresaId)
      .eq("id", id)
      .maybeSingle();
    const numero = (tk as { numero?: number } | null)?.numero ?? null;
    const asunto = ((tk as { asunto?: string } | null)?.asunto ?? "").trim();
    const tituloAviso = `Nuevo comentario${numero ? ` · T-${numero}` : ""}`;
    const cuerpoAviso = asunto ? `${asunto}: ${contenido.slice(0, 160)}` : contenido.slice(0, 200);
    // `notificar: false` = comentario sin push ni campanita (lo usa el Agente IA para sus
    // avisos de avance: comentaba mucho y sonaba todo el tiempo). Los cambios de estado
    // siguen notificando por su propia ruta.
    if (body?.notificar !== false) {
      void avisarSeguidoresMovilesSoporte({
        sb: auth.sb,
        empresaId: auth.empresaId,
        ticketId: id,
        titulo: tituloAviso,
        cuerpo: cuerpoAviso,
        excluirUsuarioId: auth.usuarioId,
      });
      // Aviso al RESPONSABLE del ticket (el dev a cargo): campanita + push. Se
      // omite solo si él mismo comentó (avisarSoporte ignora al autor del cambio).
      await avisarSoporte(auth, {
        usuarioId: (tk as { responsable_id?: string | null } | null)?.responsable_id ?? null,
        titulo: tituloAviso,
        cuerpo: cuerpoAviso,
        ticketId: id,
      });
    }
    return ok(data);
  } catch (e) {
    return errorInesperado(e);
  }
}
