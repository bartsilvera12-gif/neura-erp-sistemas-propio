/**
 * NEURA QA CENTER — autorización server-side fail-closed:
 *   (a) sesión Supabase VÁLIDA (JWT firmado por Auth; cookie o Bearer).
 *   (b) `neura.usuarios.rol = 'super_admin'` LEÍDO POR EL PROPIO USUARIO
 *       usando un cliente cookie-scoped con RLS activa — NO service_role.
 *
 * Si la DB no responde, DENEGAMOS. No hay fallback por email: la lista
 * `NEXT_PUBLIC_SUPER_ADMIN_EMAILS` no es evidencia de permiso real, y
 * confiar en ella bypassearía el cambio de rol en la BD (ej. usuario
 * degradado que sigue en el env).
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
  try {
    const sb = await createSupabaseServerClient();
    const { data, error } = await sb
      .from("usuarios")
      .select("rol")
      .eq("email", user.email)
      .limit(1);
    if (error) {
      // DB inaccesible → fail-closed.
      return denyForbidden("db_error");
    }
    const row = data?.[0] as { rol?: string | null } | undefined;
    roleFromDb = (row?.rol ?? "").trim() || null;
  } catch {
    return denyForbidden("db_exception");
  }

  if (roleFromDb !== "super_admin") {
    return denyForbidden("role_mismatch");
  }
  return { ok: true, user };
}

function denyForbidden(reason: string): QaAuthResult {
  return {
    ok: false,
    response: NextResponse.json(
      { error: "No autorizado", code: "forbidden", reason },
      { status: 403 }
    ),
  };
}
