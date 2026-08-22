import "server-only";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { notificarNovedadQA } from "@/lib/proyectos/qa-notificaciones";
import { PROYECTOS_BUCKET } from "@/lib/proyectos/proyectos-archivos-storage";

export type QASupabase = Awaited<ReturnType<typeof getChatServiceClientForEmpresa>>;

/**
 * Constantes de observaciones: viven en un módulo isomórfico porque también las
 * usa la UI, y este archivo es `server-only`. Se re-exportan para que las rutas
 * de API tengan todo lo de QA en un solo import.
 */
export * from "@/lib/proyectos/qa-observaciones-config";

export const QA_ACCIONES = [
  "grupo_creado","grupo_editado","grupo_eliminado",
  "etapa_creada","etapa_editada","etapa_eliminada",
  "item_creado","item_editado","item_eliminado",
  "item_marcado","item_desmarcado",
  "comentario_editado",
  "archivo_subido","archivo_eliminado",
  "qa_clonado",
  // Observaciones (registro de hallazgos) — comparten el mismo audit trail.
  "observacion_creada","observacion_editada","observacion_eliminada",
  "observacion_estado_cambiado","observacion_asignada",
  "observacion_comentada","observacion_archivo_subido","observacion_archivo_eliminado",
  "seccion_creada","seccion_editada","seccion_eliminada",
  // Veredicto de QA: cierra o devuelve el proyecto. Notifica aparte (ver
  // `notificarVeredictoQA`), no como novedad agrupada.
  "qa_aprobado","qa_rechazado",
] as const;

export type QAAccion = (typeof QA_ACCIONES)[number];

export async function registrarEventoQA(
  sb: QASupabase,
  args: {
    empresaId: string;
    proyectoId: string;
    usuarioId: string | null;
    accion: QAAccion;
    grupoId?: string | null;
    etapaId?: string | null;
    itemId?: string | null;
    observacionId?: string | null;
    payload?: Record<string, unknown>;
  }
) {
  await sb.from("proyecto_qa_eventos").insert({
    empresa_id: args.empresaId,
    proyecto_id: args.proyectoId,
    grupo_id: args.grupoId ?? null,
    etapa_id: args.etapaId ?? null,
    item_id: args.itemId ?? null,
    observacion_id: args.observacionId ?? null,
    accion: args.accion,
    payload: args.payload ?? {},
    usuario_id: args.usuarioId,
  });

  // Las notificaciones se generan acá y no en cada endpoint: este es el único
  // punto por el que pasan los 25 de QA. `notificarNovedadQA` no lanza — un
  // fallo notificando no puede voltear la operación de QA que lo originó.
  await notificarNovedadQA(sb, {
    empresaId: args.empresaId,
    proyectoId: args.proyectoId,
    actorId: args.usuarioId,
    accion: args.accion,
    observacionId: args.observacionId ?? null,
  });
}

export async function bumpProyectoActividad(
  sb: QASupabase,
  empresaId: string,
  proyectoId: string,
  usuarioId: string | null
) {
  await sb
    .from("proyectos")
    .update({ last_activity_at: new Date().toISOString(), updated_by: usuarioId })
    .eq("empresa_id", empresaId)
    .eq("id", proyectoId);
}

export async function siguienteSortOrder(
  sb: QASupabase,
  table:
    | "proyecto_qa_grupos"
    | "proyecto_qa_etapas"
    | "proyecto_qa_items"
    | "proyecto_qa_secciones"
    | "proyecto_qa_observaciones"
    | "proyecto_qa_observacion_archivos",
  empresaId: string,
  filtro: Record<string, string>
): Promise<number> {
  let q = sb.from(table).select("sort_order").eq("empresa_id", empresaId);
  for (const [k, v] of Object.entries(filtro)) q = q.eq(k, v);
  const { data } = await q.order("sort_order", { ascending: false }).limit(1);
  const row = (data ?? [])[0] as { sort_order?: number } | undefined;
  return (row?.sort_order ?? 0) + 10;
}

/** Nombre saneado para el storage path (mismo criterio en checklist y observaciones). */
function qaStem(originalName: string): string {
  const trimmed = (originalName || "archivo").trim() || "archivo";
  const dot = trimmed.lastIndexOf(".");
  const base = dot > 0 ? trimmed.slice(0, dot) : trimmed;
  const ext = dot > 0 ? trimmed.slice(dot + 1) : "";
  const safeBase =
    base
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80)
      .toLowerCase() || "archivo";
  const safeExt = ext.replace(/[^\w]+/g, "").slice(0, 12).toLowerCase();
  return safeExt ? `${safeBase}.${safeExt}` : safeBase;
}

export function buildQAArchivoPath(empresaId: string, proyectoId: string, itemId: string, originalName: string) {
  const unique = crypto.randomUUID();
  return `${empresaId}/${proyectoId}/qa/${itemId}/${unique}-${qaStem(originalName)}`;
}

export function buildQAObservacionArchivoPath(
  empresaId: string,
  proyectoId: string,
  observacionId: string,
  originalName: string
) {
  const unique = crypto.randomUUID();
  return `${empresaId}/${proyectoId}/qa/obs/${observacionId}/${unique}-${qaStem(originalName)}`;
}

/**
 * Correlativo `numero` de la próxima observación del proyecto (QA-001, QA-002…).
 *
 * Es un MAX+1 sin lock: alcanza para la carga real del módulo, pero dos altas
 * simultáneas pueden pedir el mismo número. El UNIQUE
 * `(empresa_id, proyecto_id, numero)` es la red de contención — ante `23505`
 * (ver `esErrorNumeroDuplicado`) la ruta reintenta una vez.
 */
export async function siguienteNumeroObservacion(
  sb: QASupabase,
  empresaId: string,
  proyectoId: string
): Promise<number> {
  const { data, error } = await sb
    .from("proyecto_qa_observaciones")
    .select("numero")
    .eq("empresa_id", empresaId)
    .eq("proyecto_id", proyectoId)
    .order("numero", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const row = (data ?? [])[0] as { numero?: number } | undefined;
  return (row?.numero ?? 0) + 1;
}

/** ¿El insert falló por colisión del correlativo y conviene reintentar? */
export function esErrorNumeroDuplicado(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const rec = error as { code?: string; message?: string };
  if (rec.code !== "23505") return false;
  return /uq_pqobs_numero|numero/i.test(rec.message ?? "");
}

/** ¿El insert de sección chocó con el índice único por nombre normalizado? */
export function esErrorSeccionDuplicada(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const rec = error as { code?: string; message?: string };
  if (rec.code !== "23505") return false;
  return /uq_pqsec_nombre|nombre/i.test(rec.message ?? "");
}

// ---------------------------------------------------------------------------
// Observaciones — lectura enriquecida
// ---------------------------------------------------------------------------

/** Los adjuntos de QA se sirven con signed URL de 1 hora (galería + export). */
export const QA_OBSERVACION_SIGNED_URL_TTL = 60 * 60;

// Literales de una sola pieza a propósito: el cliente tipado de Supabase infiere
// las columnas a partir del string literal, y una concatenación (`"a" + "b"`)
// colapsa a `string` y rompe la inferencia.
export const QA_SECCION_SELECT =
  "id, proyecto_id, nombre, color, sort_order, created_by, created_at, updated_at" as const;

export const QA_OBSERVACION_SELECT =
  "id, proyecto_id, seccion_id, numero, titulo, descripcion, estado, severidad, origen, url_referencia, asignado_a, fecha_limite, resuelto_por, resuelto_at, verificado_por, verificado_at, sort_order, ronda, created_by, created_at, updated_at" as const;

export const QA_OBSERVACION_ARCHIVO_SELECT =
  "id, observacion_id, nombre, storage_bucket, storage_path, mime_type, size_bytes, sort_order, uploaded_by, created_at" as const;

export const QA_OBSERVACION_COMENTARIO_SELECT =
  "id, observacion_id, texto, origen, autor_id, created_at, updated_at" as const;

export type QASeccionRow = {
  id: string;
  proyecto_id: string;
  nombre: string;
  color: string | null;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type QAObservacionRow = {
  id: string;
  proyecto_id: string;
  seccion_id: string | null;
  numero: number;
  titulo: string;
  descripcion: string | null;
  estado: string;
  severidad: string;
  origen: string;
  url_referencia: string | null;
  asignado_a: string | null;
  fecha_limite: string | null;
  resuelto_por: string | null;
  resuelto_at: string | null;
  verificado_por: string | null;
  verificado_at: string | null;
  sort_order: number;
  /** Ronda de revisión a la que pertenece (1 = primera revisión). */
  ronda: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type QAObservacionArchivoRow = {
  id: string;
  observacion_id: string;
  nombre: string;
  storage_bucket: string | null;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  sort_order: number;
  uploaded_by: string | null;
  created_at: string;
};

/** Adjunto tal como viaja al cliente: sin el path interno, con la URL firmada. */
export type QAObservacionArchivoPublico = Omit<
  QAObservacionArchivoRow,
  "storage_bucket" | "storage_path"
> & { url: string | null };

/**
 * `origen` del COMENTARIO — quién habla en ese mensaje ("qa" o "tecnico") —, no
 * confundir con `QAObservacionRow.origen` (de dónde salió el HALLAZGO: cliente,
 * interno, etc.). Son dos campos del mismo nombre en tablas distintas, con
 * significados distintos.
 */
/**
 * Carril donde vive un comentario de una observación:
 *  - `qa`      → "Nota de QA", visible para Desarrollo.
 *  - `tecnico` → "Respuesta del técnico", visible para Desarrollo.
 *  - `interno` → Seguimiento interno PM ↔ QA. NUNCA se le envía a Desarrollo;
 *    el filtro se aplica en la API (ver `qa-permisos.ts`).
 */
export type QAComentarioOrigen = "qa" | "tecnico" | "interno";

export function esQAComentarioOrigen(value: unknown): value is QAComentarioOrigen {
  return value === "qa" || value === "tecnico" || value === "interno";
}

export type QAObservacionComentarioRow = {
  id: string;
  observacion_id: string;
  texto: string;
  origen: QAComentarioOrigen;
  autor_id: string | null;
  created_at: string;
  updated_at: string;
};

export type QAObservacionComentarioPublico = QAObservacionComentarioRow & {
  autor_nombre: string | null;
};

export type QAObservacionEnriquecida = QAObservacionRow & {
  archivos: QAObservacionArchivoPublico[];
  comentarios_count: number;
  asignado_nombre: string | null;
  resuelto_por_nombre: string | null;
  verificado_por_nombre: string | null;
  created_by_nombre: string | null;
};

/**
 * Nombres de usuario desde el schema de catálogo (`usuarios` no vive en el
 * schema de datos de la empresa). Mismo criterio que `GET /api/proyectos/[id]`.
 */
export async function nombresUsuarios(
  empresaId: string,
  ids: Array<string | null | undefined>
): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((u): u is string => Boolean(u)))];
  if (unicos.length === 0) return new Map();
  const catalog = createServiceRoleClient();
  const { data } = await catalog
    .from("usuarios")
    .select("id, nombre")
    .eq("empresa_id", empresaId)
    .in("id", unicos);
  return new Map(((data ?? []) as Array<{ id: string; nombre?: string | null }>).map((u) => [u.id, (u.nombre ?? "").trim()]));
}

/** Saca del adjunto lo que no debe salir del server (bucket + path) y le pega la URL firmada. */
export function aArchivoPublico(
  row: QAObservacionArchivoRow,
  url: string | null
): QAObservacionArchivoPublico {
  return {
    id: row.id,
    observacion_id: row.observacion_id,
    nombre: row.nombre,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    sort_order: row.sort_order,
    uploaded_by: row.uploaded_by,
    created_at: row.created_at,
    url,
  };
}

/** Signed URLs en lote (una llamada por bucket), indexadas por `bucket:path`. */
async function firmarArchivos(
  sb: QASupabase,
  archivos: QAObservacionArchivoRow[]
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (archivos.length === 0) return urls;

  const porBucket = new Map<string, string[]>();
  for (const a of archivos) {
    const bucket = a.storage_bucket || PROYECTOS_BUCKET;
    const paths = porBucket.get(bucket) ?? [];
    paths.push(a.storage_path);
    porBucket.set(bucket, paths);
  }

  await Promise.all(
    [...porBucket.entries()].map(async ([bucket, paths]) => {
      const { data } = await sb.storage
        .from(bucket)
        .createSignedUrls(paths, QA_OBSERVACION_SIGNED_URL_TTL);
      for (const s of data ?? []) {
        if (s.path && s.signedUrl) urls.set(`${bucket}:${s.path}`, s.signedUrl);
      }
    })
  );
  return urls;
}

/**
 * Completa las observaciones con adjuntos (ya firmados), conteo de comentarios
 * y nombres de usuario, en una cantidad fija de queries — el cliente no vuelve
 * a pedir nada por fila.
 */
export async function enriquecerObservaciones(
  sb: QASupabase,
  empresaId: string,
  rows: QAObservacionRow[]
): Promise<QAObservacionEnriquecida[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [archivosRes, comentariosRes, nombres] = await Promise.all([
    sb
      .from("proyecto_qa_observacion_archivos")
      .select(QA_OBSERVACION_ARCHIVO_SELECT)
      .eq("empresa_id", empresaId)
      .in("observacion_id", ids)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    sb
      .from("proyecto_qa_observacion_comentarios")
      .select("observacion_id")
      .eq("empresa_id", empresaId)
      .in("observacion_id", ids),
    nombresUsuarios(
      empresaId,
      rows.flatMap((r) => [r.asignado_a, r.resuelto_por, r.verificado_por, r.created_by])
    ),
  ]);

  if (archivosRes.error) throw new Error(archivosRes.error.message);
  if (comentariosRes.error) throw new Error(comentariosRes.error.message);

  const archivos = (archivosRes.data ?? []) as QAObservacionArchivoRow[];
  const urls = await firmarArchivos(sb, archivos);

  const archivosPorObs = new Map<string, QAObservacionArchivoPublico[]>();
  for (const a of archivos) {
    const bucket = a.storage_bucket || PROYECTOS_BUCKET;
    const lista = archivosPorObs.get(a.observacion_id) ?? [];
    lista.push(aArchivoPublico(a, urls.get(`${bucket}:${a.storage_path}`) ?? null));
    archivosPorObs.set(a.observacion_id, lista);
  }

  const comentariosPorObs = new Map<string, number>();
  for (const c of (comentariosRes.data ?? []) as Array<{ observacion_id: string }>) {
    comentariosPorObs.set(c.observacion_id, (comentariosPorObs.get(c.observacion_id) ?? 0) + 1);
  }

  const nombre = (uid: string | null): string | null => (uid ? nombres.get(uid) || null : null);

  return rows.map((r) => ({
    ...r,
    archivos: archivosPorObs.get(r.id) ?? [],
    comentarios_count: comentariosPorObs.get(r.id) ?? 0,
    asignado_nombre: nombre(r.asignado_a),
    resuelto_por_nombre: nombre(r.resuelto_por),
    verificado_por_nombre: nombre(r.verificado_por),
    created_by_nombre: nombre(r.created_by),
  }));
}

/** La sección existe dentro del proyecto de la request. */
export async function existeSeccion(
  sb: QASupabase,
  empresaId: string,
  proyectoId: string,
  seccionId: string
): Promise<boolean> {
  const { data, error } = await sb
    .from("proyecto_qa_secciones")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("proyecto_id", proyectoId)
    .eq("id", seccionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

/** La observación existe y pertenece a la empresa + proyecto de la request. */
export async function fetchObservacion(
  sb: QASupabase,
  empresaId: string,
  proyectoId: string,
  observacionId: string
): Promise<QAObservacionRow | null> {
  const { data, error } = await sb
    .from("proyecto_qa_observaciones")
    .select(QA_OBSERVACION_SELECT)
    .eq("empresa_id", empresaId)
    .eq("proyecto_id", proyectoId)
    .eq("id", observacionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as QAObservacionRow | null) ?? null;
}
