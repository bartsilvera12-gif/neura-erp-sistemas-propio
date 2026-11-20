/**
 * NEURA QA CENTER — resolución de autorización.
 *
 * Reglas (fuera del super_admin global):
 *   1. El usuario debe pertenecer a la empresa interna Neura, identificada
 *      EXPLÍCITAMENTE por `QA_NEURA_INTERNAL_COMPANY_ID` (env var obligatoria).
 *      No basta con que la empresa tenga el módulo habilitado — se exige la
 *      coincidencia de UUID y adicionalmente `data_schema='neura'` como
 *      segunda señal.
 *   2. El módulo `qa_center` debe estar activo en `empresa_modulos` para esa
 *      empresa.
 *   3. El usuario debe tener asignación individual `usuario_modulos.qa_center`.
 *
 * Importante: el rol `administrador` / `admin` NO otorga acceso automático
 * (no reusamos `resolveEffectiveModules`, que haría esa expansión). Cada
 * asignación es explícita por usuario.
 *
 * Toda la validación se hace con cliente cookie-scoped (RLS respeta la
 * identidad del propio usuario). Nunca se usa service_role.
 */

import type { AppSupabaseClient } from "@/lib/supabase/schema";

export type QaAccessDecision =
  | { ok: true; reason: "super_admin" | "neura_qa_member" }
  | { ok: false; reason: QaAccessDenyReason };

export type QaAccessDenyReason =
  | "user_not_found"
  | "db_error"
  | "wrong_company"
  | "company_module_inactive"
  | "user_module_missing"
  | "config_missing";

const QA_SLUG = "qa_center";

export async function resolveQaAccess(
  sb: AppSupabaseClient,
  email: string
): Promise<QaAccessDecision> {
  const neuraCompanyId = process.env.QA_NEURA_INTERNAL_COMPANY_ID?.trim();
  if (!neuraCompanyId) {
    return { ok: false, reason: "config_missing" };
  }

  // 1) Leer el propio usuario (RLS permite self-read por policy usuarios_select).
  const { data: userRows, error: userErr } = await sb
    .from("usuarios")
    .select("id, rol, empresa_id")
    .eq("email", email)
    .limit(1);
  if (userErr) return { ok: false, reason: "db_error" };
  const user = (userRows?.[0] ?? null) as
    | { id: string; rol: string | null; empresa_id: string | null }
    | null;
  if (!user) return { ok: false, reason: "user_not_found" };

  // 2) Super_admin → acceso incondicional.
  if ((user.rol ?? "").trim() === "super_admin") {
    return { ok: true, reason: "super_admin" };
  }

  // 3) Doble verificación de empresa Neura: UUID exacto + data_schema.
  if (user.empresa_id !== neuraCompanyId) {
    return { ok: false, reason: "wrong_company" };
  }
  const { data: empRows, error: empErr } = await sb
    .from("empresas")
    .select("id, data_schema")
    .eq("id", neuraCompanyId)
    .limit(1);
  if (empErr) return { ok: false, reason: "db_error" };
  const emp = (empRows?.[0] ?? null) as
    | { id: string; data_schema: string | null }
    | null;
  if (!emp || (emp.data_schema ?? "").trim() !== "neura") {
    return { ok: false, reason: "wrong_company" };
  }

  // 4) Obtener modulo_id del slug qa_center desde el catálogo.
  const { data: modRows, error: modErr } = await sb
    .from("modulos")
    .select("id")
    .eq("slug", QA_SLUG)
    .limit(1);
  if (modErr) return { ok: false, reason: "db_error" };
  const modId = (modRows?.[0] as { id: string } | undefined)?.id;
  if (!modId) {
    // El módulo no existe en el catálogo todavía (migración pendiente).
    return { ok: false, reason: "company_module_inactive" };
  }

  // 5) El módulo debe estar activo para la empresa.
  const { data: emRows, error: emErr } = await sb
    .from("empresa_modulos")
    .select("activo")
    .eq("empresa_id", user.empresa_id)
    .eq("modulo_id", modId)
    .eq("activo", true)
    .limit(1);
  if (emErr) return { ok: false, reason: "db_error" };
  if (!emRows?.length) return { ok: false, reason: "company_module_inactive" };

  // 6) El usuario debe tener asignación individual.
  const { data: umRows, error: umErr } = await sb
    .from("usuario_modulos")
    .select("id")
    .eq("usuario_id", user.id)
    .eq("modulo_id", modId)
    .limit(1);
  if (umErr) return { ok: false, reason: "db_error" };
  if (!umRows?.length) return { ok: false, reason: "user_module_missing" };

  return { ok: true, reason: "neura_qa_member" };
}
