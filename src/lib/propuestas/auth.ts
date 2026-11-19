import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { getAuthUserForApiRoute } from "@/lib/auth/get-auth-user-for-api-route";
import { resolveUsuarioErpFromAuthUser } from "@/lib/auth/resolve-usuario-erp";
import { puedeVerPropuestas } from "@/lib/propuestas/acceso";

export type PropuestasAuth =
  | { ok: true; empresaId: string; usuarioId: string }
  | { ok: false; status: number; message: string };

/**
 * El permiso real del módulo: el correo sale de la sesión de Supabase, nunca de
 * algo que mande el navegador.
 */
export async function requirePropuestasAcceso(request: Request): Promise<PropuestasAuth> {
  const user = await getAuthUserForApiRoute(request);
  if (!user?.id) return { ok: false, status: 401, message: "No autenticado" };
  if (!puedeVerPropuestas(user.email)) return { ok: false, status: 403, message: "No tenés acceso a Propuestas" };

  const usuario = await resolveUsuarioErpFromAuthUser(createServiceRoleClient(), user);
  if (!usuario?.empresa_id) return { ok: false, status: 403, message: "Usuario sin empresa" };
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
