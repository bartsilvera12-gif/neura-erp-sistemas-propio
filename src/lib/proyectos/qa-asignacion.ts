import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { QA_ETAPA_INICIAL } from "@/lib/proyectos/etapas-qa";

/**
 * Resuelve la ÚNICA persona de QA activa de la empresa (`es_qa = true`).
 * Devuelve su id, o null si hay 0 o más de 1 (en ese caso no se puede adivinar
 * a quién asignar y se deja para elección manual desde el selector de responsable).
 */
export async function resolverQaUnica(empresaId: string): Promise<string | null> {
  const catalog = createServiceRoleClient();
  const { data } = await catalog
    .from("usuarios")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("es_qa", true)
    .ilike("estado", "activo");
  const ids = (data ?? []) as { id: string }[];
  return ids.length === 1 ? ids[0].id : null;
}

/**
 * Campos a aplicar sobre `proyectos` para asignar el ciclo de QA a una persona:
 * la marca responsable, la fecha de asignación (arranca el contador) y la etapa
 * inicial de revisión (lo hace aparecer en el bloque activo de QA del tablero).
 */
export function patchAsignacionQa(qaUsuarioId: string, ahoraIso: string): Record<string, unknown> {
  return {
    qa_responsable_id: qaUsuarioId,
    qa_asignado_at: ahoraIso,
    qa_etapa: QA_ETAPA_INICIAL,
    qa_etapa_at: ahoraIso,
  };
}
