import "server-only";
import { NextResponse } from "next/server";
import { getAuthWithRol, isAdmin } from "@/lib/middleware/auth";
import { createServiceRoleClientForEmpresa } from "@/lib/supabase/empresa-data-schema";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import type { KpisFuncionario, TipoIncidencia } from "@/lib/personal/types";

/** Bucket privado para los documentos de RRHH. */
export const PERSONAL_BUCKET = "personal";
export const URL_FIRMADA_TTL = 60 * 60; // 1 hora

export const ok = <T>(data: T) => NextResponse.json(successResponse(data));
export const falla = (mensaje: string, status = 400) =>
  NextResponse.json(errorResponse(mensaje), { status });
export const errorInesperado = (e: unknown) =>
  falla(e instanceof Error ? e.message : "Error inesperado", 500);

export type PersonalContexto = {
  empresaId: string;
  usuarioId: string | null;
  sb: AppSupabaseClient;
};

/**
 * Gate del módulo: RRHH es sensible (incidencias, documentos), solo admin de la
 * empresa. Devuelve el contexto con el cliente de servicio del schema del tenant.
 */
export async function requirePersonalApi(
  request: Request
): Promise<{ ok: true; ctx: PersonalContexto } | { ok: false; respuesta: NextResponse }> {
  const auth = await getAuthWithRol(request);
  if (!auth) return { ok: false, respuesta: falla("No autenticado", 401) };
  if (!isAdmin(auth)) return { ok: false, respuesta: falla("Solo RRHH / administración puede acceder a Gestión de Personal", 403) };
  const sb = await createServiceRoleClientForEmpresa(auth.empresa_id);
  return { ok: true, ctx: { empresaId: auth.empresa_id, usuarioId: auth.usuarioCatalogId ?? null, sb } };
}

/** Crea el bucket privado de documentos si no existe (idempotente, best-effort). */
export async function ensurePersonalBucket(): Promise<void> {
  try {
    await createServiceRoleClient().storage.createBucket(PERSONAL_BUCKET, { public: false });
  } catch {
    /* ya existe */
  }
}

/** KPIs de un empleado a partir de sus incidencias (en el período pedido). */
export function kpisDesdeIncidencias(tipos: TipoIncidencia[]): KpisFuncionario {
  let llegadas = 0;
  let reconocimientos = 0;
  let incidencias = 0;
  for (const t of tipos) {
    if (t === "llegada_tardia") llegadas++;
    else if (t === "reconocimiento") reconocimientos++;
    else incidencias++; // amonestación, suspensión, ausencia justificada, observación
  }
  return { asistencia: null, llegadas_tardias: llegadas, incidencias, reconocimientos };
}

/** Nombres de usuarios por id (para "registrado por" y supervisor). */
export async function nombresPorId(
  sb: AppSupabaseClient,
  empresaId: string,
  ids: (string | null | undefined)[]
): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))];
  const mapa = new Map<string, string>();
  if (!unicos.length) return mapa;
  const { data } = await sb
    .from("usuarios")
    .select("id, nombre")
    .eq("empresa_id", empresaId)
    .in("id", unicos);
  for (const r of (data ?? []) as { id: string; nombre: string | null }[]) {
    mapa.set(r.id, r.nombre ?? "Usuario");
  }
  return mapa;
}
