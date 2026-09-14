import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import {
  calcularSla,
  etiquetaTipo,
  type CatalogosSoporte,
  type InfoSla,
  type TicketFila,
} from "@/lib/soporte/dominio";
import { clientesPorId, personasPorId, type Persona } from "@/lib/soporte/servidor";

export type TicketVista = TicketFila & {
  cliente_nombre: string | null;
  responsable: Persona | null;
  creador: Persona | null;
  tipo_etiqueta: string;
  clasificacion_nombre: string | null;
  estado_nombre: string;
  estado_color: string;
  estado_tipo: "abierto" | "cerrado";
  estado_area: string | null;
  prioridad_nombre: string;
  prioridad_color: string;
  sla: InfoSla;
};

/**
 * Tickets listos para mostrar: etiquetas de los catálogos, nombres de personas
 * y clientes, y el estado del SLA calculado en el momento.
 *
 * Todo en lote —una consulta de personas y una de clientes para la página
 * entera— y no por fila.
 */
export async function enriquecerTickets(
  sb: AppSupabaseClient,
  empresaId: string,
  cat: CatalogosSoporte,
  filas: TicketFila[]
): Promise<TicketVista[]> {
  const [personas, clientes] = await Promise.all([
    personasPorId(filas.flatMap((t) => [t.responsable_id, t.created_by])),
    clientesPorId(sb, empresaId, filas.map((t) => t.cliente_id)),
  ]);
  const ahora = new Date().toISOString();

  return filas.map((t) => {
    const estado = cat.estados.find((e) => e.codigo === t.estado_codigo);
    const prioridad = cat.prioridades.find((p) => p.codigo === t.prioridad_codigo);
    const clasif = cat.clasificaciones.find((c) => c.codigo === t.clasificacion_codigo);
    return {
      ...t,
      cliente_nombre: t.cliente_id ? (clientes.get(t.cliente_id) ?? null) : null,
      responsable: t.responsable_id ? (personas.get(t.responsable_id) ?? null) : null,
      creador: t.created_by ? (personas.get(t.created_by) ?? null) : null,
      tipo_etiqueta: etiquetaTipo(cat, t.tipo_codigo, t.clasificacion_codigo),
      clasificacion_nombre: clasif?.nombre ?? null,
      estado_nombre: estado?.nombre ?? t.estado_codigo,
      estado_color: estado?.color ?? "#94a3b8",
      estado_tipo: estado?.tipo ?? "abierto",
      estado_area: estado?.area ?? null,
      prioridad_nombre: prioridad?.nombre ?? t.prioridad_codigo,
      prioridad_color: prioridad?.color ?? "#94a3b8",
      sla: calcularSla(t, ahora),
    };
  });
}
