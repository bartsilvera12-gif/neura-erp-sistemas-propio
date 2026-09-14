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

/**
 * Resuelve `zentra_erp.usuarios` en Server Actions / RSC usando cookies de sesión:
 * `getUser` + lectura de catálogo con service role (misma idea que `resolveApiAuthContext`).
 */
export async function getUsuarioCatalogFromServerCookies(): Promise<{
  id: string;
  empresa_id: string;
} | null> {
  // Si la ruta dejó un Bearer en el contexto (app nativa), manda ese: no hay cookies que leer.
  // Para todo lo demás el contexto está vacío y esto sigue exactamente como antes.
  const delContexto = bearerDelContexto();
  if (delContexto) return resolverDesdeBearer(delContexto);

  // Una ráfaga de acciones seguidas de la misma persona no tiene por qué
  // revalidar el token en cada una: es un viaje a la red antes de empezar.
  const clave = await claveDeSesion();
  if (clave) {
    const guardado = cacheUsuarioSesion.get(clave);
    if (guardado) return guardado;
  }

  const catalogClient = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await catalogClient.auth.getUser();
  if (error || !user?.id) return null;

  const sr = createServiceRoleClient();
  const usuario = await resolveUsuarioErpFromAuthUser(sr, user);
  if (!usuario?.id) return null;
  if (!usuario.empresa_id) return null;

  const resuelto = { id: usuario.id, empresa_id: usuario.empresa_id };
  // Sólo lo que salió bien. Un rechazo no se cachea: si a alguien le acaban de
  // arreglar el acceso, tiene que entrar en el próximo intento.
  if (clave) cacheUsuarioSesion.set(clave, resuelto);
  return resuelto;
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
export async function getUsuarioCatalogFromRequest(
  request?: Request | null
): Promise<{ id: string; empresa_id: string } | null> {
  const bearer = request ? extractBearerTokenFromRequest(request) : null;
  if (!bearer) return getUsuarioCatalogFromServerCookies();
  return resolverDesdeBearer(bearer);
}

/** Resuelve `zentra_erp.usuarios` a partir de un JWT, sin pasar por cookies. */
async function resolverDesdeBearer(
  bearer: string
): Promise<{ id: string; empresa_id: string } | null> {
  // La caché va por token: dos personas nunca comparten uno.
  const guardado = cacheUsuarioSesion.get(`bearer:${bearer}`);
  if (guardado) return guardado;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;

  const { data, error } = await createClient(url, anonKey).auth.getUser(bearer);
  if (error || !data.user?.id) return null;

  const usuario = await resolveUsuarioErpFromAuthUser(createServiceRoleClient(), data.user);
  if (!usuario?.id || !usuario.empresa_id) return null;

  const salida = { id: usuario.id, empresa_id: usuario.empresa_id };
  cacheUsuarioSesion.set(`bearer:${bearer}`, salida);
  return salida;
}
