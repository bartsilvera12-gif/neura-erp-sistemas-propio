import "server-only";
import { cookies } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  extractBearerTokenFromRequest,
  getAuthUserForApiRoute,
} from "@/lib/auth/get-auth-user-for-api-route";
import { resolveUsuarioErpFromAuthUser } from "@/lib/auth/resolve-usuario-erp";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { SOPORTE_SLUG, puedeConfigurarSoporte, puedeUsarSoporte } from "@/lib/soporte/permisos";
import { memoriaSesion, type SesionSoporte } from "@/lib/soporte/cache";

export type SoporteContexto = {
  ok: true;
  empresaId: string;
  usuarioId: string;
  rol: string | null;
  puedeConfigurar: boolean;
  /** Cliente del schema de datos de la empresa (service role). */
  sb: AppSupabaseClient;
};

export type SoporteAuth = SoporteContexto | { ok: false; status: number; message: string };

/**
 * ¿Tiene el módulo Soporte asignado a mano? Sólo cuenta una fila explícita en
 * `usuario_modulos`; ante un error se niega (nunca se abre por las dudas).
 */
async function tieneModuloConcedido(svc: ReturnType<typeof createServiceRoleClient>, usuarioId: string): Promise<boolean> {
  const { data: modulo, error: e1 } = await svc.from("modulos").select("id").eq("slug", SOPORTE_SLUG).maybeSingle();
  if (e1 || !modulo?.id) return false;
  const { data, error } = await svc
    .from("usuario_modulos")
    .select("modulo_id")
    .eq("usuario_id", usuarioId)
    .eq("modulo_id", modulo.id)
    .limit(1);
  return !error && (data?.length ?? 0) > 0;
}

/** Tilde de Project Manager del catálogo de usuarios. Ante un error, no. */
async function esProjectManager(svc: ReturnType<typeof createServiceRoleClient>, usuarioId: string): Promise<boolean> {
  const { data, error } = await svc.from("usuarios").select("es_project_manager").eq("id", usuarioId).maybeSingle();
  return !error && (data as { es_project_manager?: boolean | null } | null)?.es_project_manager === true;
}

async function sesionDe(
  clave: string,
  obtenerUsuario: () => Promise<{ id: string; email?: string | null } | null>
): Promise<SesionSoporte | null> {
  if (clave) {
    const guardada = memoriaSesion.get(clave);
    if (guardada) return guardada;
  }
  const user = await obtenerUsuario();
  if (!user?.id) return null;
  const svc = createServiceRoleClient();
  const usuario = await resolveUsuarioErpFromAuthUser(svc, user as never);
  if (!usuario?.id || !usuario.empresa_id) return null;
  const sesion: SesionSoporte = {
    usuarioId: usuario.id,
    empresaId: usuario.empresa_id,
    rol: usuario.rol,
    email: user.email ?? null,
    concedido: await tieneModuloConcedido(svc, usuario.id),
    pm: await esProjectManager(svc, usuario.id),
  };
  // Sólo lo que salió bien: si a alguien le acaban de arreglar el acceso, tiene
  // que entrar en el próximo intento y no dentro de 30 segundos.
  if (clave) memoriaSesion.set(clave, sesion);
  return sesion;
}

/**
 * El PERMISO se decide acá en cada request, con el rol de la sesión. La caché
 * ahorra el viaje a Auth y la búsqueda del usuario, no la autorización.
 */
async function contexto(sesion: SesionSoporte | null): Promise<SoporteAuth> {
  if (!sesion) return { ok: false, status: 401, message: "No autenticado" };
  const sujeto = { rol: sesion.rol, email: sesion.email, concedido: sesion.concedido };
  if (!puedeUsarSoporte(sujeto)) return { ok: false, status: 403, message: "Sin acceso al módulo Soporte" };
  return {
    ok: true,
    empresaId: sesion.empresaId,
    usuarioId: sesion.usuarioId,
    rol: sesion.rol,
    puedeConfigurar: puedeConfigurarSoporte(sujeto),
    sb: await getChatServiceClientForEmpresa(sesion.empresaId),
  };
}

/**
 * Permiso SÓLO para cargar un ticket desde Conversaciones: quien usa Soporte y,
 * además, los Project Managers aunque no tengan el módulo. No abre el resto
 * del módulo (listados, edición, configuración).
 */
export async function requireCargaSoporteApi(request: Request): Promise<SoporteAuth> {
  const token = extractBearerTokenFromRequest(request);
  const sesion = await sesionDe(token ? `bearer:${token}` : "", () => getAuthUserForApiRoute(request));
  if (sesion?.pm) {
    return {
      ok: true,
      empresaId: sesion.empresaId,
      usuarioId: sesion.usuarioId,
      rol: sesion.rol,
      puedeConfigurar: false,
      sb: await getChatServiceClientForEmpresa(sesion.empresaId),
    };
  }
  return contexto(sesion);
}

/**
 * Permiso para las rutas de API. Se llama al principio de CADA handler: una
 * mutación no puede confiar en que la página ya filtró al usuario.
 */
export async function requireSoporteApi(request: Request): Promise<SoporteAuth> {
  const token = extractBearerTokenFromRequest(request);
  const sesion = await sesionDe(token ? `bearer:${token}` : "", () => getAuthUserForApiRoute(request));
  return contexto(sesion);
}

async function claveCookies(): Promise<string> {
  try {
    const jar = await cookies();
    const partes = jar
      .getAll()
      .filter((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"))
      .map((c) => `${c.name}=${c.value}`)
      .sort();
    return partes.length ? `cookie:${partes.join("|")}` : "";
  } catch {
    return "";
  }
}

/**
 * Permiso para páginas y layouts (servidor, con las cookies de la sesión).
 * Cubre la URL escrita a mano y el refresh directo de cualquier subruta.
 */
export async function requireSoporteServidor(): Promise<SoporteAuth> {
  const clave = await claveCookies();
  const sesion = await sesionDe(clave, async () => {
    const sb = await createSupabaseServerClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    return user ? { id: user.id, email: user.email ?? null } : null;
  });
  return contexto(sesion);
}
