/**
 * NEURA QA CENTER — autorización server-side SIN service_role.
 *
 * El ERP marca super_admins por dos vías:
 *  1. Email en la lista `NEXT_PUBLIC_SUPER_ADMIN_EMAILS` (o la lista bootstrap
 *     hard-codeada en `isBootstrapSuperAdminEmail`). Lectura: solo env, sin DB.
 *  2. Campo `rol = 'super_admin'` en la tabla `neura.usuarios`.
 *
 * QA Center usa SOLO la vía (1) para evitar leer `neura.usuarios` desde este
 * módulo — mantiene el principio de mínimo privilegio: QA Center nunca lee
 * tablas de otros schemas, nunca usa `service_role`, nunca usa el superuser
 * `postgres`. Los admins que no estén en el env quedan explícitamente fuera
 * del panel.
 */

import type { User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getAuthUserForApiRoute } from "@/lib/auth/get-auth-user-for-api-route";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/super-admin-bootstrap-email";

export type QaAuthResult =
  | { ok: true; user: User }
  | { ok: false; response: NextResponse };

export async function assertSuperAdmin(request: Request): Promise<QaAuthResult> {
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
  if (!isBootstrapSuperAdminEmail(user.email)) {
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
