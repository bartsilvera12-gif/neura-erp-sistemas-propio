import "server-only";
import { fechaObjetivoAIso, puedeEstarACargo, requiereResponsable, slaDe, vencimientoSla } from "@/lib/soporte/dominio";
import type { SoporteContexto } from "@/lib/soporte/soporte-auth";
import {
  leerCatalogos,
  personasDeEmpresa,
  registrarHistorial,
  type EventoHistorial,
} from "@/lib/soporte/servidor";

const UUID = /^[0-9a-f-]{36}$/i;

export function textoTicket(v: unknown, max = 20_000): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

/** Fila lista para insertar en `soporte_tickets` (sin número: lo pone el trigger). */
export type FilaTicketNueva = {
  empresa_id: string;
  numero: 0;
  asunto: string;
  descripcion: string;
  resultado_esperado: string | null;
  impacto_operativo: string | null;
  pasos_reproducir: string | null;
  criterios_aceptacion: string | null;
  cliente_id: string;
  proyecto_id: string | null;
  modulo: string | null;
  version: string | null;
  entorno: string | null;
  navegador: string | null;
  tipo_codigo: string;
  clasificacion_codigo: string | null;
  prioridad_codigo: string;
  estado_codigo: string;
  responsable_id: string | null;
  proxima_accion: string | null;
  sla_horas: number | null;
  fecha_objetivo: string | null;
  created_by: string;
  updated_by: string;
};

export type TicketPreparado = {
  fila: FilaTicketNueva;
  /** Datos legibles para la respuesta y el historial del cliente. Nada sensible. */
  resumen: {
    estado: string;
    estado_nombre: string;
    prioridad: string;
    prioridad_nombre: string;
    clasificacion: string | null;
    clasificacion_nombre: string | null;
    proyecto_titulo: string | null;
  };
};

export type ResultadoPreparacion = { ok: true; ticket: TicketPreparado } | { ok: false; mensaje: string; status: number };

/**
 * Valida el pedido de alta y arma la fila del ticket. ÚNICA regla de alta.
 *
 * La usan el alta normal de Soporte y la tipificación de cliente, así el estado
 * inicial, el SLA (congelado desde el catálogo de la empresa) y las
 * validaciones de pertenencia son exactamente los mismos por cualquier puerta.
 * No inserta nada.
 */
export async function prepararTicket(
  auth: SoporteContexto,
  body: Record<string, unknown>,
  opciones: { exigirProyecto?: boolean } = {}
): Promise<ResultadoPreparacion> {
  const falla = (mensaje: string, status = 400): ResultadoPreparacion => ({ ok: false, mensaje, status });
  const cat = await leerCatalogos(auth.sb, auth.empresaId);

  const clienteId = typeof body.cliente_id === "string" ? body.cliente_id : "";
  if (!UUID.test(clienteId)) return falla("Elegí un cliente");
  const { data: cliente } = await auth.sb
    .from("clientes")
    .select("id")
    .eq("empresa_id", auth.empresaId)
    .eq("id", clienteId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!cliente) return falla("El cliente no existe");

  const tipo = cat.tipos.find((t) => t.activo && t.codigo === body.tipo_codigo);
  if (!tipo) return falla("Elegí el tipo de solicitud");

  const clasificacionesDelTipo = cat.clasificaciones.filter((c) => c.activo && c.tipo_codigo === tipo.codigo);
  let clasificacion: (typeof clasificacionesDelTipo)[number] | null = null;
  if (clasificacionesDelTipo.length > 0) {
    const c = clasificacionesDelTipo.find((x) => x.codigo === body.clasificacion_codigo);
    if (!c) return falla("Elegí la clasificación");
    clasificacion = c;
  }

  const prioridad = cat.prioridades.find((x) => x.activo && x.codigo === body.prioridad_codigo);
  if (!prioridad) return falla("Elegí la prioridad");

  const asunto = textoTicket(body.asunto, 200);
  if (!asunto) return falla("El asunto es obligatorio");
  const descripcion = textoTicket(body.descripcion);
  if (!descripcion) return falla("La descripción es obligatoria");

  let proyectoId: string | null = null;
  let proyectoTitulo: string | null = null;
  if (typeof body.proyecto_id === "string" && body.proyecto_id) {
    if (!UUID.test(body.proyecto_id)) return falla("Proyecto inválido");
    const { data: pr } = await auth.sb
      .from("proyectos")
      .select("id, titulo")
      .eq("empresa_id", auth.empresaId)
      .eq("id", body.proyecto_id)
      .eq("cliente_id", clienteId)
      .maybeSingle();
    if (!pr) return falla("El proyecto no pertenece a ese cliente", 403);
    proyectoId = body.proyecto_id;
    proyectoTitulo = (pr as { titulo?: string | null }).titulo ?? null;
  } else if (opciones.exigirProyecto) {
    return falla("Elegí el proyecto o servicio afectado");
  }

  let responsableId: string | null = null;
  if (typeof body.responsable_id === "string" && body.responsable_id) {
    const equipo = await personasDeEmpresa(auth.empresaId);
    if (!equipo.some((u) => u.id === body.responsable_id && puedeEstarACargo(u))) return falla("A cargo sólo pueden quedar Desarrollo o QA");
    responsableId = body.responsable_id;
  }

  let fechaObjetivo: string | null = null;
  if (typeof body.fecha_objetivo === "string" && body.fecha_objetivo) {
    const iso = fechaObjetivoAIso(body.fecha_objetivo);
    if (!iso) return falla("Fecha objetivo inválida");
    fechaObjetivo = iso;
  }

  const inicial = cat.estados.find((e) => e.es_inicial) ?? cat.estados[0];
  // Todo ticket nuevo entra en el estado inicial (Pendiente), tenga o no responsable.
  const estado = inicial;
  if (!estado) return falla("Soporte no tiene estados configurados", 500);
  if (requiereResponsable(estado) && !responsableId) return falla("Elegí un responsable");

  const slaHoras = slaDe(cat, tipo.codigo, clasificacion?.codigo ?? null);
  // Sin fecha objetivo, vence cuando se cumple el SLA de su clasificación (error o
  // cambio) en horas laborales. Un tipo sin SLA queda sin fecha.
  if (!fechaObjetivo && clasificacion) fechaObjetivo = vencimientoSla(Date.now(), slaHoras);

  return {
    ok: true,
    ticket: {
      fila: {
        empresa_id: auth.empresaId,
        numero: 0,
        asunto,
        descripcion,
        resultado_esperado: textoTicket(body.resultado_esperado),
        impacto_operativo: textoTicket(body.impacto_operativo),
        pasos_reproducir: textoTicket(body.pasos_reproducir),
        criterios_aceptacion: textoTicket(body.criterios_aceptacion),
        cliente_id: clienteId,
        proyecto_id: proyectoId,
        modulo: textoTicket(body.modulo, 120),
        version: textoTicket(body.version, 60),
        entorno: textoTicket(body.entorno, 60),
        navegador: textoTicket(body.navegador, 120),
        tipo_codigo: tipo.codigo,
        clasificacion_codigo: clasificacion?.codigo ?? null,
        prioridad_codigo: prioridad.codigo,
        estado_codigo: estado.codigo,
        responsable_id: responsableId,
        proxima_accion: textoTicket(body.proxima_accion, 500),
        sla_horas: slaHoras,
        fecha_objetivo: fechaObjetivo,
        created_by: auth.usuarioId,
        updated_by: auth.usuarioId,
      },
      resumen: {
        estado: estado.codigo,
        estado_nombre: estado.nombre,
        prioridad: prioridad.codigo,
        prioridad_nombre: prioridad.nombre,
        clasificacion: clasificacion?.codigo ?? null,
        clasificacion_nombre: clasificacion?.nombre ?? null,
        proyecto_titulo: proyectoTitulo,
      },
    },
  };
}

/** Eventos de alta en el historial del ticket (mismo formato por cualquier origen). */
export async function registrarAltaTicket(
  auth: SoporteContexto,
  args: { ticketId: string; numero: number; ticket: TicketPreparado; metadataExtra?: Record<string, unknown> }
): Promise<void> {
  const f = args.ticket.fila;
  const eventos: EventoHistorial[] = [
    {
      tipo_evento: "creacion",
      valor_nuevo: f.estado_codigo,
      metadata: {
        numero: args.numero,
        tipo: f.tipo_codigo,
        clasificacion: f.clasificacion_codigo,
        prioridad: f.prioridad_codigo,
        sla_horas: f.sla_horas,
        ...(args.metadataExtra ?? {}),
      },
    },
  ];
  if (f.responsable_id) {
    eventos.push({ tipo_evento: "cambio_responsable", valor_anterior: null, valor_nuevo: f.responsable_id });
  }
  await registrarHistorial(auth.sb, {
    empresaId: auth.empresaId,
    ticketId: args.ticketId,
    usuarioId: auth.usuarioId,
    eventos,
  });
}
