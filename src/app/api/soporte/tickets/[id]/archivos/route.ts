import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { requireCargaSoporteApi, requireSoporteApi } from "@/lib/soporte/soporte-auth";
import { ARCHIVO_MAX_BYTES, mimeAceptado } from "@/lib/soporte/dominio";
import {
  SOPORTE_BUCKET,
  SOPORTE_URL_FIRMADA_TTL,
  errorInesperado,
  falla,
  ok,
  personasPorId,
  prefijoArchivosTicket,
  registrarHistorial,
  sinPermiso,
  ticketDeEmpresa,
  tocarTicket,
} from "@/lib/soporte/servidor";

type Params = { params: Promise<{ id: string }> };

/** GET — archivos del ticket, con URL firmada de corta duración para ver o bajar. */
export async function GET(request: Request, { params }: Params) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  try {
    const { id } = await params;
    if (!(await ticketDeEmpresa(auth.sb, auth.empresaId, id, "id"))) return falla("Ticket no encontrado", 404);

    const { data, error } = await auth.sb
      .from("soporte_ticket_archivos")
      .select("id, nombre, descripcion, storage_path, mime_type, size_bytes, subido_por, comentario_id, created_at")
      .eq("empresa_id", auth.empresaId)
      .eq("ticket_id", id)
      .order("created_at", { ascending: true });
    if (error) return falla(error.message);

    const filas = (data ?? []) as {
      id: string;
      nombre: string;
      descripcion: string | null;
      storage_path: string;
      mime_type: string | null;
      size_bytes: number | null;
      subido_por: string | null;
      comentario_id: string | null;
      created_at: string;
    }[];
    const personas = await personasPorId(filas.map((a) => a.subido_por));
    const storage = createServiceRoleClient().storage.from(SOPORTE_BUCKET);

    const archivos = await Promise.all(
      filas.map(async (a) => {
        const { data: firmada } = await storage.createSignedUrl(a.storage_path, SOPORTE_URL_FIRMADA_TTL);
        const { data: descarga } = await storage.createSignedUrl(a.storage_path, SOPORTE_URL_FIRMADA_TTL, {
          download: a.nombre,
        });
        return {
          id: a.id,
          nombre: a.nombre,
          descripcion: a.descripcion,
          mime_type: a.mime_type,
          size_bytes: a.size_bytes,
          comentario_id: a.comentario_id,
          created_at: a.created_at,
          subido_por: a.subido_por ? (personas.get(a.subido_por) ?? null) : null,
          url: firmada?.signedUrl ?? null,
          url_descarga: descarga?.signedUrl ?? null,
        };
      })
    );
    return ok(archivos);
  } catch (e) {
    return errorInesperado(e);
  }
}

/**
 * POST — registra un archivo que el navegador YA subió al Storage con la URL
 * firmada de `archivos/firmar`.
 *
 * El archivo no pasa por esta ruta: en Vercel el cuerpo de un request tiene un
 * límite de 4,5 MB, y un video de evidencia lo supera enseguida. Acá sólo se
 * verifica que el objeto exista, que esté dentro de la carpeta de ESTE ticket,
 * y se deja la fila y el evento de historial.
 */
export async function POST(request: Request, { params }: Params) {
  // Adjuntar evidencias al cargar el ticket: también los PM.
  const auth = await requireCargaSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  try {
    const { id } = await params;
    if (!(await ticketDeEmpresa(auth.sb, auth.empresaId, id, "id"))) return falla("Ticket no encontrado", 404);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const path = typeof body?.path === "string" ? body.path : "";
    const nombre = typeof body?.nombre === "string" ? body.nombre.trim().slice(0, 200) : "";
    const mime = typeof body?.mime_type === "string" ? body.mime_type : "";
    const descripcion = typeof body?.descripcion === "string" ? body.descripcion.trim().slice(0, 300) || null : null;
    const comentarioId = typeof body?.comentario_id === "string" && body.comentario_id ? body.comentario_id : null;

    const prefijo = prefijoArchivosTicket(auth.empresaId, id);
    // Sin esto, alguien podría registrar en su ticket un archivo de otro.
    if (!path.startsWith(prefijo) || path.includes("..")) return falla("Ruta de archivo inválida", 400);
    if (!nombre) return falla("Falta el nombre del archivo");
    if (!mimeAceptado(mime, nombre)) return falla("Tipo de archivo no permitido");

    const storage = createServiceRoleClient().storage.from(SOPORTE_BUCKET);
    const carpeta = path.slice(0, path.lastIndexOf("/"));
    const archivo = path.slice(path.lastIndexOf("/") + 1);
    const { data: listado } = await storage.list(carpeta, { search: archivo, limit: 5 });
    const objeto = (listado ?? []).find((o) => o.name === archivo);
    if (!objeto) return falla("El archivo no terminó de subirse");
    const size = Number((objeto.metadata as { size?: number } | null)?.size ?? 0) || null;
    if (size && size > ARCHIVO_MAX_BYTES) {
      await storage.remove([path]).catch(() => {});
      return falla("El archivo supera el máximo permitido");
    }

    if (comentarioId) {
      const { data: com } = await auth.sb
        .from("soporte_ticket_comentarios")
        .select("id")
        .eq("ticket_id", id)
        .eq("id", comentarioId)
        .maybeSingle();
      if (!com) return falla("Comentario inválido");
    }

    const { data, error } = await auth.sb
      .from("soporte_ticket_archivos")
      .insert({
        empresa_id: auth.empresaId,
        ticket_id: id,
        comentario_id: comentarioId,
        nombre,
        descripcion,
        storage_bucket: SOPORTE_BUCKET,
        storage_path: path,
        mime_type: mime || null,
        size_bytes: size,
        subido_por: auth.usuarioId,
      })
      .select("id")
      .single();
    if (error || !data) {
      await storage.remove([path]).catch(() => {});
      return falla(error?.message ?? "No se pudo registrar el archivo");
    }

    await registrarHistorial(auth.sb, {
      empresaId: auth.empresaId,
      ticketId: id,
      usuarioId: auth.usuarioId,
      eventos: [{ tipo_evento: "archivo_agregado", valor_nuevo: nombre, metadata: { archivo_id: data.id, size } }],
    });
    await tocarTicket(auth.sb, auth.empresaId, id, auth.usuarioId);
    return ok({ id: data.id });
  } catch (e) {
    return errorInesperado(e);
  }
}

