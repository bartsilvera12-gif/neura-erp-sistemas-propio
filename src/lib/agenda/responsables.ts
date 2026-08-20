import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

/**
 * Lectura y escritura de `agenda_cita_responsables` (varios responsables por
 * cita).
 *
 * Todo acá tolera que la tabla NO exista todavía: el código puede desplegarse
 * antes de que la migración corra, y en ese caso la agenda sigue andando con el
 * responsable principal (`agenda_citas.responsable_id`) en vez de romperse con
 * un 42P01. Cuando la tabla aparece, empieza a usarse sola.
 */

/** `42P01 undefined_table` — la migración todavía no corrió en este schema. */
function esTablaInexistente(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string };
  if (e.code === "42P01") return true;
  const msg = (e.message ?? "").toLowerCase();
  return msg.includes("agenda_cita_responsables") && msg.includes("does not exist");
}

/**
 * Responsables de varias citas, indexados por `cita_id`.
 *
 * Devuelve `null` (no un Map vacío) cuando la tabla no existe, para que quien
 * llame distinga "no hay tabla, usá el responsable principal" de "la tabla está
 * y esta cita no tiene filas".
 */
export async function responsablesPorCita(
  sb: AppSupabaseClient,
  empresaId: string,
  citaIds: string[]
): Promise<Map<string, string[]> | null> {
  if (citaIds.length === 0) return new Map();
  const { data, error } = await sb
    .from("agenda_cita_responsables")
    .select("cita_id, usuario_id")
    .eq("empresa_id", empresaId)
    .in("cita_id", citaIds);

  if (error) {
    if (esTablaInexistente(error)) return null;
    throw new Error(error.message);
  }

  const out = new Map<string, string[]>();
  for (const row of (data ?? []) as { cita_id: string; usuario_id: string }[]) {
    const arr = out.get(row.cita_id) ?? [];
    arr.push(row.usuario_id);
    out.set(row.cita_id, arr);
  }
  return out;
}

/**
 * Deja la lista de responsables de una cita EXACTAMENTE en `usuarioIds`.
 *
 * El responsable principal se fuerza dentro de la lista: la columna
 * `responsable_id` sigue siendo la que usan disponibilidad y anti-doble-reserva,
 * así que las dos representaciones no pueden contradecirse.
 *
 * Borra e inserta en vez de calcular el diff: son pocas filas por cita y así no
 * quedan estados intermedios raros si alguien saca y agrega a la misma persona.
 */
export async function guardarResponsables(
  sb: AppSupabaseClient,
  empresaId: string,
  citaId: string,
  principalId: string,
  usuarioIds: string[]
): Promise<void> {
  const ids = [...new Set([principalId, ...usuarioIds])].filter(
    (id) => typeof id === "string" && id.length > 0
  );

  const del = await sb
    .from("agenda_cita_responsables")
    .delete()
    .eq("empresa_id", empresaId)
    .eq("cita_id", citaId);
  if (del.error) {
    // Sin tabla no hay nada que guardar: la cita queda con su responsable
    // principal, que es el comportamiento previo a esta funcionalidad.
    if (esTablaInexistente(del.error)) return;
    throw new Error(del.error.message);
  }

  const ins = await sb
    .from("agenda_cita_responsables")
    .insert(ids.map((usuario_id) => ({ cita_id: citaId, usuario_id, empresa_id: empresaId })));
  if (ins.error && !esTablaInexistente(ins.error)) {
    throw new Error(ins.error.message);
  }
}

/**
 * Ids de las citas en las que participa un usuario (como responsable). Se usa
 * para el filtro "mis citas" y para los recordatorios.
 *
 * `null` = la tabla no existe; quien llame debe filtrar por `responsable_id`.
 */
export async function citaIdsDeUsuario(
  sb: AppSupabaseClient,
  empresaId: string,
  usuarioId: string
): Promise<string[] | null> {
  const { data, error } = await sb
    .from("agenda_cita_responsables")
    .select("cita_id")
    .eq("empresa_id", empresaId)
    .eq("usuario_id", usuarioId);
  if (error) {
    if (esTablaInexistente(error)) return null;
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => (r as { cita_id: string }).cita_id);
}
