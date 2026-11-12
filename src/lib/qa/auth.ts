/**
 * NEURA QA CENTER — gating de autorización server-side.
 * Reutiliza los helpers de auth existentes (`getAuthUserForApiRoute`,
 * `resolveUsuarioErpFromAuthUser`, `isBootstrapSuperAdminEmail`). No los
 * modifica ni duplica.
 *
 * Patrón idéntico al usado en `src/app/api/admin/modulos/route.ts`.
 */

import { createClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getAuthUserForApiRoute } from "@/lib/auth/get-auth-user-for-api-route";
import { resolveUsuarioErpFromAuthUser } from "@/lib/auth/resolve-usuario-erp";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/super-admin-bootstrap-email";
import {
  supabaseServiceRoleClientOptions,
  type AppSupabaseClient,
} from "@/lib/supabase/schema";

export type QaAuthResult =
  | { ok: true; user: User; serviceClient: AppSupabaseClient }
  | { ok: false; response: NextResponse };

/**
 * Resuelve al usuario autenticado y confirma que es super_admin.
 * Retorna el service-role client ya creado para que el caller no lo repita.
 *
 * Nunca retorna un cliente con permisos ampliados si la validación falla.
 */
export async function assertSuperAdmin(request: Request): Promise<QaAuthResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !key) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Config no disponible", code: "internal" },
        { status: 500 }
      ),
    };
  }

  const user = await getAuthUserForApiRoute(request);
  if (!user?.id) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "No autenticado", code: "unauthorized" },
        { status: 401 }
      ),
    };
  }

  const serviceClient = createClient(url, key, {
    ...supabaseServiceRoleClientOptions,
  });
  const usuario = await resolveUsuarioErpFromAuthUser(serviceClient, user);
  const rolSuper = (usuario?.rol ?? "").trim() === "super_admin";
  const bootstrapSuper = isBootstrapSuperAdminEmail(user.email);
  if (!rolSuper && !bootstrapSuper) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "No autorizado", code: "forbidden" },
        { status: 403 }
      ),
    };
  }

  return { ok: true, user, serviceClient };
}
