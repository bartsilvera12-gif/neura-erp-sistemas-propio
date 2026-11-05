import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import {
  calcularSla,
  etiquetaTipo,
  type CatalogosSoporte,
  type InfoSla,
  type TicketFila,
} from "@/lib/soporte/dominio";
import {
  clientesPorId,
  personasPorId,
  proyectosPorCliente,
  type Persona,
  type ProyectoLite,
} from "@/lib/soporte/servidor";

export type TicketVista = TicketFila & {
  cliente_nombre: string | null;
  /** Proyectos del cliente del ticket (columna "Proyecto"), del más nuevo al más viejo. */
  proyectos_cliente: ProyectoLite[];
  responsable: Persona | null;
  creador: Persona | null;
  tipo_etiqueta: string;
  clasificacion_nombre: string | null;
  /** Sub-estado de la tipificación que originó el ticket (columna MOTIVO). Null si no vino de tipificación. */
  origen_subestado: string | null;
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
  // El sub-estado que originó el ticket se muestra en MOTIVO. Se resuelve por el
  // vínculo que ya tiene el ticket (tipificacion_id → tipificaciones.estado_id →
  // tipificacion_estados.nombre), así sirve también para tickets viejos y refleja
  // renombres; sin columna nueva. La consulta de tipificaciones va en lote con el resto.
  const tipIds = [...new Set(filas.map((t) => t.tipificacion_id).filter((x): x is string => Boolean(x)))];
  const [personas, clientes, proyectos, tipsRes] = await Promise.all([
    personasPorId(filas.flatMap((t) => [t.responsable_id, t.created_by])),
    clientesPorId(sb, empresaId, filas.map((t) => t.cliente_id)),
    proyectosPorCliente(sb, empresaId, filas.map((t) => t.cliente_id)),
    tipIds.length
      ? sb.from("tipificaciones").select("id, estado_id").eq("empresa_id", empresaId).in("id", tipIds)
      : Promise.resolve({ data: [] as { id: string; estado_id: string | null }[] }),
  ]);

  // tipificacion_id → nombre del sub-estado.
  const subestadoPorTicket = new Map<string, string>();
  const estadoPorTip = new Map<string, string>();
  const estadoIds = new Set<string>();
  for (const r of ((tipsRes.data ?? []) as { id: string; estado_id: string | null }[])) {
    if (r.estado_id) {
      estadoPorTip.set(r.id, r.estado_id);
      estadoIds.add(r.estado_id);
    }
  }
  if (estadoIds.size) {
    const { data: ests } = await sb
      .from("tipificacion_estados")
      .select("id, nombre")
      .eq("empresa_id", empresaId)
      .in("id", [...estadoIds]);
    const nombrePorEstado = new Map<string, string>();
    for (const e of ((ests ?? []) as { id: string; nombre: string }[])) nombrePorEstado.set(e.id, e.nombre);
    for (const t of filas) {
      const eid = t.tipificacion_id ? estadoPorTip.get(t.tipificacion_id) : undefined;
      const nom = eid ? nombrePorEstado.get(eid) : undefined;
      if (nom) subestadoPorTicket.set(t.id, nom);
    }
  }

  const ahora = new Date().toISOString();

  return filas.map((t) => {
    const estado = cat.estados.find((e) => e.codigo === t.estado_codigo);
    const prioridad = cat.prioridades.find((p) => p.codigo === t.prioridad_codigo);
    const clasif = cat.clasificaciones.find((c) => c.codigo === t.clasificacion_codigo);
    return {
      ...t,
      cliente_nombre: t.cliente_id ? (clientes.get(t.cliente_id) ?? null) : null,
      proyectos_cliente: t.cliente_id ? (proyectos.get(t.cliente_id) ?? []) : [],
      responsable: t.responsable_id ? (personas.get(t.responsable_id) ?? null) : null,
      creador: t.created_by ? (personas.get(t.created_by) ?? null) : null,
      tipo_etiqueta: etiquetaTipo(cat, t.tipo_codigo, t.clasificacion_codigo),
      clasificacion_nombre: clasif?.nombre ?? null,
      origen_subestado: subestadoPorTicket.get(t.id) ?? null,
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
