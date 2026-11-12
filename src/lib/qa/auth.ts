/**
 * NEURA QA CENTER — autorización server-side con permisos de módulo.
 *
 * Reutiliza el modelo existente del ERP (`neura.modulos`, `empresa_modulos`,
 * `usuario_modulos`) SIN cambiar su funcionamiento: no se escribe en esas
 * tablas, no se usa `resolveEffectiveModules` del ERP, y se consulta con
 * cliente cookie-scoped (RLS respeta identidad del user). NO service_role.
 *
 * Reglas resumidas (detalle en `authorize.ts`):
 *   - super_admin → acceso incondicional
 *   - resto → empresa Neura (UUID + data_schema='neura') + módulo activo
 *     en empresa + asignación individual del usuario. Rol administrador NO
 *     otorga acceso automático.
 */

import type { User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getAuthUserForApiRoute } from "@/lib/auth/get-auth-user-for-api-route";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveQaAccess } from "./authorize";

export type QaAuthResult =
  | { ok: true; user: User; via: "super_admin" | "neura_qa_member" }
  | { ok: false; response: NextResponse };

/**
 * Compat alias: muchas rutas siguen llamando `assertSuperAdmin`. La semántica
 * cambia (ahora autoriza al equipo QA de Neura, no solo super_admins) pero el
 * shape de retorno es compatible.
 */
export async function assertSuperAdmin(request: Request): Promise<QaAuthResult> {
  return assertQaCenterAccess(request);
}

export async function assertQaCenterAccess(request: Request): Promise<QaAuthResult> {
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

  const sb = await createSupabaseServerClient();
  const decision = await resolveQaAccess(sb, user.email);
  if (!decision.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "No autorizado", code: "forbidden", reason: decision.reason },
        { status: 403 }
      ),
    };
  }
  return { ok: true, user, via: decision.reason };
}
