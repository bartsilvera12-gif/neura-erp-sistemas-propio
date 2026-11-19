import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { getAuthUserForApiRoute } from "@/lib/auth/get-auth-user-for-api-route";
import { resolveUsuarioErpFromAuthUser } from "@/lib/auth/resolve-usuario-erp";
import { resolveEffectiveModules } from "@/lib/modulos/resolve-effective-modules";
import { MODULO_QUE_HABILITA, puedeVerPropuestas } from "@/lib/propuestas/acceso";

export type PropuestasAuth =
  | { ok: true; empresaId: string; usuarioId: string }
  | { ok: false; status: number; message: string };

/**
 * El permiso real del módulo. Todo sale de la sesión de Supabase, nunca de algo que mande el
 * navegador: entra quien tiene el módulo CRM Funnel entre sus módulos efectivos (los mismos
 * que usa el menú), un super admin, o un correo de la lista de `acceso.ts`.
 */
export async function requirePropuestasAcceso(request: Request): Promise<PropuestasAuth> {
  const user = await getAuthUserForApiRoute(request);
  if (!user?.id) return { ok: false, status: 401, message: "No autenticado" };

  const supabase = createServiceRoleClient();
  const usuario = await resolveUsuarioErpFromAuthUser(supabase, user);
  if (!usuario?.empresa_id) return { ok: false, status: 403, message: "Usuario sin empresa" };

  let permitido = puedeVerPropuestas(user.email) || (usuario.rol ?? "").trim() === "super_admin";
  if (!permitido) {
    const modulos = await resolveEffectiveModules(supabase, { id: usuario.id, empresa_id: usuario.empresa_id, rol: usuario.rol });
    permitido = modulos.some((m) => m.slug === MODULO_QUE_HABILITA);
  }
  if (!permitido) return { ok: false, status: 403, message: "No tenés acceso a Propuestas" };
  return { ok: true, empresaId: usuario.empresa_id, usuarioId: usuario.id };
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Texto de formulario: recortado y con tope de largo. */
export function texto(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** Monto en guaraníes: entero ≥ 0, o null si viene vacío. */
export function monto(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}
