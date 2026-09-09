import { cookies } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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
