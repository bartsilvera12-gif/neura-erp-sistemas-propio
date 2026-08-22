import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import type { AgendaCitaEnriquecida, AgendaCitaRow, AgendaUsuarioRef } from "@/lib/agenda/types";
import { responsablesPorCita } from "@/lib/agenda/responsables";

function uniq(ids: (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))];
}

/**
 * Agrega datos de cliente (schema de datos vía `sb`) y responsable (catálogo
 * `zentra_erp.usuarios` vía service role) a las filas de agenda, igual que
 * `enrichProyectosRows`.
 */
export async function enrichAgendaRows(
  sb: AppSupabaseClient,
  empresaId: string,
  rows: AgendaCitaRow[]
): Promise<AgendaCitaEnriquecida[]> {
  if (rows.length === 0) return [];

  const clienteIds = uniq(rows.map((r) => r.cliente_id));

  // Responsables extra + quién cargó cada cita. `null` = la tabla de
  // responsables todavía no existe en este schema (migración sin correr): se
  // cae de vuelta al responsable principal.
  const extras = await responsablesPorCita(
    sb,
    empresaId,
    rows.map((r) => r.id)
  );

  const userIds = uniq([
    ...rows.map((r) => r.responsable_id),
    ...rows.map((r) => r.created_by),
    ...(extras ? [...extras.values()].flat() : []),
  ]);

  const catalog = createServiceRoleClient();

  const [clientesR, usersR] = await Promise.all([
    clienteIds.length
      ? sb
          .from("clientes")
          .select("id,empresa,nombre_contacto,telefono")
          .eq("empresa_id", empresaId)
          .in("id", clienteIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    userIds.length
      ? catalog.from("usuarios").select("id,nombre").eq("empresa_id", empresaId).in("id", userIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  const clientesMap = new Map(
    (clientesR.data ?? []).map((t) => {
      const row = t as { id: string };
      return [row.id, row] as const;
    })
  );
  const usersMap = new Map(
    (usersR.data ?? []).map((t) => {
      const row = t as { id: string };
      return [row.id, row] as const;
    })
  );

  return rows.map((r) => {
    const out: AgendaCitaEnriquecida = { ...r };
    if (r.cliente_id) {
      const c = clientesMap.get(r.cliente_id) as
        | { id: string; empresa?: string | null; nombre_contacto?: string | null; telefono?: string | null }
        | undefined;
      out.cliente = c
        ? {
            id: c.id,
            nombre: (c.nombre_contacto?.trim() || c.empresa?.trim() || null) ?? null,
            telefono: c.telefono ?? null,
          }
        : { id: r.cliente_id, nombre: null, telefono: null };
    } else {
      out.cliente = null;
    }
    const ref = (id: string): AgendaUsuarioRef => {
      const u = usersMap.get(id) as { id: string; nombre?: string } | undefined;
      return { id, nombre: u?.nombre ?? null };
    };

    out.responsable = ref(r.responsable_id);
    // El principal va SIEMPRE primero, esté o no en la tabla de responsables.
    const idsExtra = extras?.get(r.id) ?? [];
    out.responsables = [
      r.responsable_id,
      ...idsExtra.filter((id) => id !== r.responsable_id),
    ].map(ref);
    out.creado_por = r.created_by ? ref(r.created_by) : null;
    return out;
  });
}
