import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { extractBearerTokenFromRequest } from "@/lib/auth/get-auth-user-for-api-route";
import { bearerDelContexto } from "@/lib/auth/bearer-contexto";
import { resolveUsuarioErpFromAuthUser } from "@/lib/auth/resolve-usuario-erp";
import { cacheUsuarioSesion } from "@/lib/auth/cache-sesion-servidor";

/**
 * Clave de caché: el valor de las cookies de sesión de Supabase.
 *
 * Se usa la cookie y no el id del usuario porque el id todavía no se conoce —
 * es justo lo que se está por resolver. Dos personas distintas nunca comparten
 * cookie, así que no hay forma de que una vea la sesión de otra.
 */
async function claveDeSesion(): Promise<string> {
  try {
    const jar = await cookies();
    const partes = jar
      .getAll()
      .filter((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"))
      .map((c) => `${c.name}=${c.value}`)
      .sort();
    return partes.length > 0 ? partes.join("|") : "";
  } catch {
    return "";
  }
}

export type UsuarioResuelto = { id: string; empresa_id: string };

/**
 * Por qué no se pudo resolver al usuario.
 *
 * Los tres casos terminaban en el mismo `null` y las rutas mostraban "Iniciá sesión"
 * para todos. Solo el primero se arregla volviendo a entrar: a un asesor sin alta en
 * el ERP, o sin empresa asignada, el cartel lo mandaba a cerrar y abrir sesión para
 * siempre sin que nada cambiara.
 */
export type MotivoSinUsuario = "sin_sesion" | "sin_alta_erp" | "sin_empresa";

export type ResultadoUsuario =
  | { ok: true; usuario: UsuarioResuelto }
  | { ok: false; motivo: MotivoSinUsuario };

/**
 * Resuelve `zentra_erp.usuarios` en Server Actions / RSC usando cookies de sesión:
 * `getUser` + lectura de catálogo con service role (misma idea que `resolveApiAuthContext`).
 */
export async function getUsuarioCatalogFromServerCookiesConMotivo(): Promise<ResultadoUsuario> {
  // Si la ruta dejó un Bearer en el contexto (app nativa), manda ese: no hay cookies que leer.
  // Para todo lo demás el contexto está vacío y esto sigue exactamente como antes.
  const delContexto = bearerDelContexto();
  if (delContexto) return resolverDesdeBearerConMotivo(delContexto);

  // Una ráfaga de acciones seguidas de la misma persona no tiene por qué
  // revalidar el token en cada una: es un viaje a la red antes de empezar.
  const clave = await claveDeSesion();
  if (clave) {
    const guardado = cacheUsuarioSesion.get(clave);
    if (guardado) return { ok: true, usuario: guardado };
  }

  const catalogClient = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await catalogClient.auth.getUser();
  if (error || !user?.id) return { ok: false, motivo: "sin_sesion" };

  const sr = createServiceRoleClient();
  const usuario = await resolveUsuarioErpFromAuthUser(sr, user);
  if (!usuario?.id) return { ok: false, motivo: "sin_alta_erp" };
  if (!usuario.empresa_id) return { ok: false, motivo: "sin_empresa" };

  const resuelto = { id: usuario.id, empresa_id: usuario.empresa_id };
  // Sólo lo que salió bien. Un rechazo no se cachea: si a alguien le acaban de
  // arreglar el acceso, tiene que entrar en el próximo intento.
  if (clave) cacheUsuarioSesion.set(clave, resuelto);
  return { ok: true, usuario: resuelto };
}

/** Igual, pero devolviendo `null` como siempre: lo que usan las rutas que no miran el motivo. */
export async function getUsuarioCatalogFromServerCookies(): Promise<UsuarioResuelto | null> {
  const r = await getUsuarioCatalogFromServerCookiesConMotivo();
  return r.ok ? r.usuario : null;
}

/**
 * Igual que `getUsuarioCatalogFromServerCookies`, pero probando primero el header
 * `Authorization: Bearer`.
 *
 * Existe por la app nativa: un cliente que no es un navegador no tiene cookies de sesión,
 * manda el JWT en el header. El resto del ERP (páginas, server actions, la app web dentro
 * de Capacitor) sigue entrando por cookies y no cambia en nada — si no viene Bearer, esto
 * delega tal cual en la función de siempre.
 */
export async function getUsuarioCatalogFromRequestConMotivo(
  request?: Request | null
): Promise<ResultadoUsuario> {
  const bearer = request ? extractBearerTokenFromRequest(request) : null;
  if (!bearer) return getUsuarioCatalogFromServerCookiesConMotivo();
  return resolverDesdeBearerConMotivo(bearer);
}

export async function getUsuarioCatalogFromRequest(
  request?: Request | null
): Promise<UsuarioResuelto | null> {
  const r = await getUsuarioCatalogFromRequestConMotivo(request);
  return r.ok ? r.usuario : null;
}

/** Resuelve `zentra_erp.usuarios` a partir de un JWT, sin pasar por cookies. */
async function resolverDesdeBearerConMotivo(bearer: string): Promise<ResultadoUsuario> {
  // La caché va por token: dos personas nunca comparten uno.
  const guardado = cacheUsuarioSesion.get(`bearer:${bearer}`);
  if (guardado) return { ok: true, usuario: guardado };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return { ok: false, motivo: "sin_sesion" };

  // Sin autoRefreshToken: con las opciones por defecto el cliente deja un setInterval para siempre (fuga).
  const { data, error } = await createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }).auth.getUser(bearer);
  if (error || !data.user?.id) return { ok: false, motivo: "sin_sesion" };

  const usuario = await resolveUsuarioErpFromAuthUser(createServiceRoleClient(), data.user);
  if (!usuario?.id) return { ok: false, motivo: "sin_alta_erp" };
  if (!usuario.empresa_id) return { ok: false, motivo: "sin_empresa" };

  const salida = { id: usuario.id, empresa_id: usuario.empresa_id };
  cacheUsuarioSesion.set(`bearer:${bearer}`, salida);
  return { ok: true, usuario: salida };
}
