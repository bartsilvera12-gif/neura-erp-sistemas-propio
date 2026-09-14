import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthUserForApiRoute } from "@/lib/auth/get-auth-user-for-api-route";
import { resolveUsuarioErpFromAuthUser } from "@/lib/auth/resolve-usuario-erp";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { puedeConfigurarSoporte, puedeUsarSoporte } from "@/lib/soporte/permisos";

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

async function resolver(
  user: { id: string; email?: string | null } | null
): Promise<SoporteAuth> {
  if (!user?.id) return { ok: false, status: 401, message: "No autenticado" };

  const catalog = createServiceRoleClient();
  const usuario = await resolveUsuarioErpFromAuthUser(catalog, user as never);
  if (!usuario?.empresa_id) return { ok: false, status: 403, message: "Usuario sin empresa" };

  const sujeto = { rol: usuario.rol, email: user.email ?? null };
  if (!puedeUsarSoporte(sujeto)) {
    return { ok: false, status: 403, message: "Sin acceso al módulo Soporte" };
  }

  return {
    ok: true,
    empresaId: usuario.empresa_id,
    usuarioId: usuario.id,
    rol: usuario.rol,
    puedeConfigurar: puedeConfigurarSoporte(sujeto),
    sb: await getChatServiceClientForEmpresa(usuario.empresa_id),
  };
}

/**
 * Permiso para las rutas de API. Se llama al principio de CADA handler: una
 * mutación no puede confiar en que la página ya filtró al usuario.
 */
export async function requireSoporteApi(request: Request): Promise<SoporteAuth> {
  const user = await getAuthUserForApiRoute(request);
  return resolver(user);
}

/**
 * Permiso para páginas y layouts (servidor, con las cookies de la sesión).
 * Cubre la URL escrita a mano y el refresh directo de cualquier subruta.
 */
export async function requireSoporteServidor(): Promise<SoporteAuth> {
  const sb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  return resolver(user ? { id: user.id, email: user.email ?? null } : null);
}
