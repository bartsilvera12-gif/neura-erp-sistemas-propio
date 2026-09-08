import "server-only";

/**
 * Chat interno del equipo: acceso, salas y adjuntos.
 *
 * Es un módulo aparte del chat omnicanal (`chat_conversations`), que modela
 * conversaciones con CLIENTES por WhatsApp —con canales, colas y atribución de
 * campañas—. Acá se habla entre compañeros: no hay canal externo, ni cola, ni
 * plantillas, y sí hay grupos y adjuntos de cualquier tipo.
 */

import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { getAuthUserForApiRoute } from "@/lib/auth/get-auth-user-for-api-route";
import { resolveUsuarioErpFromAuthUser } from "@/lib/auth/resolve-usuario-erp";
import { resolveEffectiveModules } from "@/lib/modulos/resolve-effective-modules";
import { errorResponse } from "@/lib/api/response";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

/** Slug del módulo. Es RESTRINGIDO: ver `lib/modulos/modulos-restringidos.ts`. */
export const MODULO_CHAT_INTERNO = "chat_interno";

export const CHAT_BUCKET = "chat-interno";
/** 25 MB por archivo: alcanza para un audio largo o un PDF, y no llena el storage. */
export const CHAT_ARCHIVO_MAX_BYTES = 25 * 1024 * 1024;
export const CHAT_SIGNED_URL_TTL = 60 * 60;

export type ChatAuthOk = {
  ok: true;
  empresaId: string;
  usuarioId: string;
  sb: AppSupabaseClient;
};
export type ChatAuth = ChatAuthOk | { ok: false; status: number; message: string };

/**
 * Autenticación + permiso del módulo, en un solo paso.
 *
 * El chat no se apoya en el permiso de otro módulo: tiene el suyo, y como es
 * restringido, sólo entra quien tenga la concesión explícita. Esconder el ítem
 * del menú nunca fue un permiso.
 */
export async function requireChatInterno(request: Request): Promise<ChatAuth> {
  const user = await getAuthUserForApiRoute(request);
  if (!user?.id) return { ok: false, status: 401, message: "No autenticado" };

  const catalog = createServiceRoleClient();
  const usuario = await resolveUsuarioErpFromAuthUser(catalog, user);
  if (!usuario?.empresa_id) return { ok: false, status: 403, message: "Usuario sin empresa" };

  const modulos = await resolveEffectiveModules(catalog, {
    id: usuario.id,
    empresa_id: usuario.empresa_id,
    rol: usuario.rol,
  });
  const tiene = modulos.some((m) => (m.slug ?? "").trim().toLowerCase() === MODULO_CHAT_INTERNO);
  if (!tiene) return { ok: false, status: 403, message: "Sin acceso al chat interno" };

  return {
    ok: true,
    empresaId: usuario.empresa_id,
    usuarioId: usuario.id,
    sb: await getChatServiceClientForEmpresa(usuario.empresa_id),
  };
}

export function respuestaAuth(auth: Exclude<ChatAuth, ChatAuthOk>) {
  return NextResponse.json(errorResponse(auth.message), { status: auth.status });
}

/**
 * ¿La persona es miembro de la sala?
 *
 * Se verifica en CADA operación, no sólo al listar: quien no está en la sala no
 * puede leer sus mensajes ni escribir en ella aunque conozca el id.
 */
export async function esMiembro(
  sb: AppSupabaseClient,
  salaId: string,
  usuarioId: string
): Promise<{ miembro: boolean; rol: string | null }> {
  const { data } = await sb
    .from("chat_interno_miembros")
    .select("rol")
    .eq("sala_id", salaId)
    .eq("usuario_id", usuarioId)
    .maybeSingle();
  const rol = (data as { rol?: string } | null)?.rol ?? null;
  return { miembro: rol != null, rol };
}

/** Crea el bucket privado si falta. Los adjuntos se sirven con signed URL. */
export async function ensureChatBucket(sb: AppSupabaseClient): Promise<void> {
  const { data, error } = await sb.storage.listBuckets();
  if (error) throw new Error(error.message);
  if ((data ?? []).some((b) => b.name === CHAT_BUCKET)) return;
  const { error: e } = await sb.storage.createBucket(CHAT_BUCKET, {
    public: false,
    fileSizeLimit: CHAT_ARCHIVO_MAX_BYTES,
  });
  if (e && !e.message.toLowerCase().includes("already exists")) throw new Error(e.message);
}

/** Path del adjunto. El aislamiento por empresa y sala se hace por prefijo. */
export function chatAdjuntoPath(empresaId: string, salaId: string, nombre: string): string {
  const limpio = (nombre || "archivo")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
  return `${empresaId}/${salaId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${limpio}`;
}

export type ChatAdjunto = {
  path: string;
  nombre: string;
  mime_type: string;
  size_bytes: number;
  /** `audio` se reproduce en línea; el resto se descarga. */
  clase: "audio" | "imagen" | "archivo";
};

export function claseDeAdjunto(mime: string): ChatAdjunto["clase"] {
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "imagen";
  return "archivo";
}

/** Firma los adjuntos de un lote de mensajes en UNA sola pasada por path. */
export async function firmarAdjuntos(
  sb: AppSupabaseClient,
  mensajes: { adjuntos?: unknown }[]
): Promise<Map<string, string>> {
  const paths = new Set<string>();
  for (const m of mensajes) {
    if (!Array.isArray(m.adjuntos)) continue;
    for (const a of m.adjuntos as { path?: unknown }[]) {
      if (typeof a?.path === "string" && a.path) paths.add(a.path);
    }
  }
  const out = new Map<string, string>();
  if (paths.size === 0) return out;
  const { data } = await sb.storage
    .from(CHAT_BUCKET)
    .createSignedUrls([...paths], CHAT_SIGNED_URL_TTL);
  for (const row of data ?? []) {
    if (row.path && row.signedUrl) out.set(row.path, row.signedUrl);
  }
  return out;
}

// --- Foto de perfil ----------------------------------------------------------

/**
 * Bucket propio y privado para las fotos de perfil.
 *
 * Privado y no público porque son fotos de empleados: se sirven firmadas, con
 * la misma vida que un adjunto. Por eso en la base se guarda el `path` y no una
 * URL, que vencería en una hora.
 */
export const AVATAR_BUCKET = "avatares";
/** 4 MB alcanza de sobra para una foto de perfil ya redimensionada. */
export const AVATAR_MAX_BYTES = 4 * 1024 * 1024;

export async function ensureAvatarBucket(sb: AppSupabaseClient): Promise<void> {
  const { data, error } = await sb.storage.listBuckets();
  if (error) throw new Error(error.message);
  if ((data ?? []).some((b) => b.name === AVATAR_BUCKET)) return;
  const { error: e } = await sb.storage.createBucket(AVATAR_BUCKET, {
    public: false,
    fileSizeLimit: AVATAR_MAX_BYTES,
  });
  if (e && !e.message.toLowerCase().includes("already exists")) throw new Error(e.message);
}

export function avatarPath(empresaId: string, usuarioId: string, mime: string): string {
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  // El sufijo al azar evita que el navegador siga mostrando la foto anterior.
  return `${empresaId}/${usuarioId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
}

/**
 * Firma las fotos de un conjunto de personas, en una sola pasada.
 *
 * Devuelve un mapa `usuario_id -> url`. Quien no tenga foto simplemente no
 * aparece: la UI cae en las iniciales de color, que siempre funcionan.
 */
export async function firmarAvatares(
  sb: AppSupabaseClient,
  usuarios: { id: string; avatar_path?: string | null }[]
): Promise<Map<string, string>> {
  const porPath = new Map<string, string[]>();
  for (const u of usuarios) {
    const p = u.avatar_path;
    if (typeof p !== "string" || !p) continue;
    porPath.set(p, [...(porPath.get(p) ?? []), u.id]);
  }
  const out = new Map<string, string>();
  if (porPath.size === 0) return out;
  const { data } = await sb.storage
    .from(AVATAR_BUCKET)
    .createSignedUrls([...porPath.keys()], CHAT_SIGNED_URL_TTL);
  for (const row of data ?? []) {
    if (!row.path || !row.signedUrl) continue;
    for (const id of porPath.get(row.path) ?? []) out.set(id, row.signedUrl);
  }
  return out;
}

/**
 * Cómo se llama alguien DENTRO del chat.
 *
 * `nombre_chat` es opcional y sólo vale acá: el `nombre` del catálogo es el que
 * figura en proyectos, reportes y atribuciones, y un apodo del chat no puede
 * reescribir eso. Vacío = el del catálogo.
 */
export function nombreVisible(u: {
  nombre?: string | null;
  nombre_chat?: string | null;
}): string {
  return (u.nombre_chat ?? "").trim() || (u.nombre ?? "").trim() || "—";
}
