import "server-only";
import { registrarHistorialCliente } from "@/lib/clientes/historial";
import type { TipoGestion } from "@/lib/gestion-clientes/types";
import { prepararTicket, registrarAltaTicket } from "@/lib/soporte/crear-ticket";
import type { SoporteContexto } from "@/lib/soporte/soporte-auth";
import { leerCatalogos } from "@/lib/soporte/servidor";

/**
 * Tipos de gestión que crean un ticket de Soporte, y el tipo de ticket de cada uno.
 * Es la ÚNICA puerta de alta de tickets: la tipificación del cliente y el botón
 * Soporte de Conversaciones pasan por acá.
 */
export const TIPO_TICKET_DE_GESTION: Partial<Record<TipoGestion, string>> = {
  Error: "error",
  Cambio: "cambio",
};

/**
 * Quién queda a cargo de todo ticket nuevo, por empresa. Quien carga el ticket
 * no elige: hoy lo recibe la desarrolladora de Soporte (Milagros Gómez).
 * Para cambiarlo alcanza con este mapa.
 */
const RESPONSABLE_POR_DEFECTO: Record<string, string> = {
  "9fd29108-4b0f-4faf-9eee-c509f6227d47": "5566a978-05b6-4300-8df1-b35e6b7d74dc",
};

export function responsablePorDefecto(empresaId: string): string | null {
  return RESPONSABLE_POR_DEFECTO[empresaId] ?? null;
}

export function gestionDeTipoTicket(tipoCodigo: unknown): TipoGestion | null {
  const par = Object.entries(TIPO_TICKET_DE_GESTION).find(([, t]) => t === tipoCodigo);
  return (par?.[0] as TipoGestion | undefined) ?? null;
}

export type ResultadoAlta =
  | { ok: true; tipificacion_id: string; ticket_id: string; numero: number }
  | { ok: false; mensaje: string; status: number };

/**
 * Crea la tipificación y su ticket en UNA transacción SQL
 * (`soporte_crear_ticket_desde_tipificacion`): o quedan los dos, o ninguno.
 * Después deja el alta en el historial del ticket y en el del cliente.
 *
 * El cliente y el tipo de ticket salen de los argumentos del servidor, no de
 * `datosTicket`: lo que venga en el body para esos campos se ignora.
 */
export async function crearTipificacionConTicket(
  soporte: SoporteContexto,
  args: {
    clienteId: string;
    tipoGestion: TipoGestion;
    observacion: string;
    usuario: { id: string | null; nombre: string };
    authUser: { id: string; email?: string | null } | null;
    datosTicket: Record<string, unknown>;
    exigirProyecto: boolean;
    origen: "tipificacion_cliente" | "conversacion";
    conversationId?: string | null;
  }
): Promise<ResultadoAlta> {
  const tipoCodigo = TIPO_TICKET_DE_GESTION[args.tipoGestion];
  if (!tipoCodigo) return { ok: false, mensaje: "Ese tipo de gestión no crea tickets", status: 400 };

  const prep = await prepararTicket(
    soporte,
    {
      ...args.datosTicket,
      cliente_id: args.clienteId,
      tipo_codigo: tipoCodigo,
      prioridad_codigo: args.datosTicket.prioridad_codigo ?? "normal",
      responsable_id: responsablePorDefecto(soporte.empresaId),
    },
    { exigirProyecto: args.exigirProyecto }
  );
  if (!prep.ok) return { ok: false, mensaje: prep.mensaje, status: prep.status };

  const { data: creado, error } = await soporte.sb.rpc("soporte_crear_ticket_desde_tipificacion", {
    p_tipificacion: {
      empresa_id: soporte.empresaId,
      cliente_id: args.clienteId,
      usuario: args.usuario.nombre,
      usuario_id: args.usuario.id,
      tipo_gestion: args.tipoGestion,
      resultado: "Escalar",
      observacion: args.observacion,
    },
    p_ticket: prep.ticket.fila,
  });
  if (error || !creado) {
    const mensaje = error?.message ?? "No se pudo crear el ticket";
    return { ok: false, mensaje, status: /pertenece|mismo cliente/i.test(mensaje) ? 403 : 400 };
  }
  const r = creado as { tipificacion_id: string; ticket_id: string; numero: number };

  const cat = await leerCatalogos(soporte.sb, soporte.empresaId);
  const tipoNombre = cat.tipos.find((t) => t.codigo === tipoCodigo)?.nombre ?? args.tipoGestion;

  // Auditoría: lo importante ya existe (tipificación + ticket). Ambos registros
  // son no-throwing: si fallan no se deshace nada.
  await Promise.all([
    registrarAltaTicket(soporte, {
      ticketId: r.ticket_id,
      numero: r.numero,
      ticket: prep.ticket,
      metadataExtra: { origen: args.origen, tipificacion_id: r.tipificacion_id, conversation_id: args.conversationId ?? null },
    }),
    registrarHistorialCliente(soporte.sb, {
      empresaId: soporte.empresaId,
      clienteId: args.clienteId,
      tipo: "soporte",
      accion: "ticket_created",
      authUserId: args.authUser?.id ?? null,
      email: args.authUser?.email ?? null,
      source: args.origen,
      detalle: {
        ticket_id: r.ticket_id,
        ticket_numero: r.numero,
        tipificacion_id: r.tipificacion_id,
        conversation_id: args.conversationId ?? null,
        proyecto_id: prep.ticket.fila.proyecto_id,
        proyecto_nombre: prep.ticket.resumen.proyecto_titulo,
        asunto: prep.ticket.fila.asunto,
        tipo: tipoNombre,
        clasificacion: prep.ticket.resumen.clasificacion_nombre,
        estado: prep.ticket.resumen.estado_nombre,
        sla_horas: prep.ticket.fila.sla_horas,
        fecha_objetivo: prep.ticket.fila.fecha_objetivo,
        usuario: args.usuario.nombre,
      },
    }),
  ]);

  return { ok: true, tipificacion_id: r.tipificacion_id, ticket_id: r.ticket_id, numero: r.numero };
}
