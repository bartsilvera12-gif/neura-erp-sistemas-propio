import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/service-admin";

/**
 * Vínculo puesto del organigrama ↔ usuario del sistema (`organigrama_nodos.usuario_id`).
 *
 * El organigrama guarda el nombre de la persona como texto ("Karen Ayala") y los usuarios
 * tienen el nombre completo ("KAREN MAGNOLIA AYALA URUNAGA"). Coincide cuando cada palabra
 * del puesto es el comienzo de una palabra del usuario, sin tildes ni mayúsculas, y hay UN
 * solo usuario así (si hay dos, no se adivina: queda para elegir a mano).
 */

export type UsuarioEmpresa = { id: string; nombre: string | null; nombre_chat: string | null };

export function normNombre(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function coincideNombre(persona: string, u: UsuarioEmpresa): boolean {
  const palabras = normNombre(persona).split(" ").filter(Boolean);
  if (palabras.length === 0) return false;
  const del = normNombre(`${u.nombre ?? ""} ${u.nombre_chat ?? ""}`).split(" ").filter(Boolean);
  return palabras.every((p) => del.some((d) => d.startsWith(p)));
}

export async function usuariosDeEmpresa(empresaId: string): Promise<UsuarioEmpresa[]> {
  const { data } = await createServiceRoleClient()
    .from("usuarios")
    .select("id, nombre, nombre_chat")
    .eq("empresa_id", empresaId);
  return (data ?? []) as UsuarioEmpresa[];
}

/** El usuario de un nombre de puesto, o null si no hay uno (o hay más de uno). */
export function resolverPorNombre(persona: string | null | undefined, usuarios: UsuarioEmpresa[]): string | null {
  if (!persona?.trim()) return null;
  const exactos = usuarios.filter((u) => normNombre(u.nombre_chat) === normNombre(persona) || normNombre(u.nombre) === normNombre(persona));
  if (exactos.length === 1) return exactos[0].id;
  const c = usuarios.filter((u) => coincideNombre(persona, u));
  return c.length === 1 ? c[0].id : null;
}

/**
 * Qué `usuario_id` guardar en un alta/edición de puesto:
 * - `usuarioIdBody` string → ese usuario, si es de la empresa (lo eligió quien edita).
 * - `usuarioIdBody` null → sin vincular.
 * - `undefined` → se resuelve por el nombre escrito.
 */
export async function usuarioParaNodo(
  empresaId: string,
  usuarioIdBody: unknown,
  nombrePersona: string | null
): Promise<string | null> {
  const usuarios = await usuariosDeEmpresa(empresaId);
  if (typeof usuarioIdBody === "string" && usuarioIdBody.trim()) {
    return usuarios.some((u) => u.id === usuarioIdBody.trim()) ? usuarioIdBody.trim() : null;
  }
  if (usuarioIdBody === null) return null;
  return resolverPorNombre(nombrePersona, usuarios);
}
