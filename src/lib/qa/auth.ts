/**
 * NEURA QA CENTER — autorización server-side con doble verificación:
 *   (a) sesión Supabase VÁLIDA (JWT firmado por Auth; cookie o Bearer).
 *   (b) `neura.usuarios.rol = 'super_admin'` LEÍDO POR EL PROPIO USUARIO
 *       usando un cliente cookie-scoped con RLS activa — NO service_role.
 *
 * Fallback `isBootstrapSuperAdminEmail` sólo cuando la DB está inaccesible
 * (fail-safe para bootstrap). Conocer un email de la lista NO basta por sí
 * mismo: requiere además sesión Supabase válida y, cuando la DB está sana,
 * el rol persistido en la BD.
 *
 * Por qué no es "administrativa":
 *   - `createSupabaseServerClient` es el mismo cliente que usa `/dashboard/panel-control`.
 *   - No instancia ningún cliente con la key service_role.
 *   - Lee únicamente la fila del propio usuario (RLS filtra).
 *   - No toca ninguna tabla fuera del scope de `neura.usuarios` para el self-user.
 */

import type { User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getAuthUserForApiRoute } from "@/lib/auth/get-auth-user-for-api-route";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/super-admin-bootstrap-email";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type QaAuthResult =
  | { ok: true; user: User }
  | { ok: false; response: NextResponse };

export async function assertSuperAdmin(request: Request): Promise<QaAuthResult> {
  // (a) sesión válida
  const user = await getAuthUserForApiRoute(request);
  if (!user?.id || !user.email) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "No autenticado", code: "unauthorized" },
        { status: 401 }
      ),
    };
  }

  // (b) rol en DB leído por el propio usuario (RLS).
  let roleFromDb: string | null = null;
  let dbErrored = false;
  try {
    const sb = await createSupabaseServerClient();
    const { data, error } = await sb
      .from("usuarios")
      .select("rol")
      .eq("email", user.email)
      .limit(1);
    if (error) dbErrored = true;
    else {
      const row = data?.[0] as { rol?: string | null } | undefined;
      roleFromDb = (row?.rol ?? "").trim() || null;
    }
  } catch {
    dbErrored = true;
  }

  const bootstrap = isBootstrapSuperAdminEmail(user.email);
  const authorized =
    roleFromDb === "super_admin" || (dbErrored && bootstrap);

  if (!authorized) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "No autorizado", code: "forbidden" },
        { status: 403 }
      ),
    };
  }
  return { ok: true, user };
}
