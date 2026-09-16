import "server-only";
import { registrarHistorialCliente } from "@/lib/clientes/historial";
import type { TipoGestion } from "@/lib/gestion-clientes/types";
import { prepararTicket, registrarAltaTicket } from "@/lib/soporte/crear-ticket";
import type { SoporteContexto } from "@/lib/soporte/soporte-auth";
import { clientesPorId, leerCatalogos, personasDeEmpresa } from "@/lib/soporte/servidor";
import { avisarSoporte } from "@/lib/soporte/subtareas";
import { enFranjaDeGuardia, puedeEstarACargo } from "@/lib/soporte/dominio";
import { enHorarioLaboral, TZ_OFFSET_MIN } from "@/lib/proyectos/reloj-laboral";
import { lunesDe } from "@/lib/guardias/semana";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { numeroTicket } from "@/lib/soporte/dominio";

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
 * Desarrollo de Soporte en horario laboral, por empresa: hoy Milagros Luján
 * Gómez Flores. Para cambiarlo alcanza con este mapa.
 */
const RESPONSABLE_HORARIO_LABORAL: Record<string, string> = {
  "9fd29108-4b0f-4faf-9eee-c509f6227d47": "5566a978-05b6-4300-8df1-b35e6b7d74dc",
};

export { enFranjaDeGuardia };

export type MotivoAsignacion = "ordinario" | "guardia" | "guardia_sin_asignar";

export type AsignacionAutomatica = {
  responsableId: string | null;
  motivo: MotivoAsignacion;
};

/**
 * Quién recibe un ticket nuevo. Quien lo carga no elige.
 * (Proceso de Gestión de Soporte v1.4, §11)
 *
 *   · Un ERROR cargado en la franja de guardia (fin de jornada a 20:00) va al
 *     desarrollador principal de la guardia de esa semana (módulo Guardias).
 *   · Todo lo demás —errores en horario laboral o fuera de la franja, y todos
 *     los cambios, que nunca entran a guardia— sigue el proceso ordinario:
 *     Desarrollo de Soporte.
 *   · El suplente NO se asigna solo: asume cuando el principal avisa que no
 *     puede, y eso se registra a mano.
 *
 * Sólo se asigna a alguien que puede quedar a cargo (Desarrollo o QA).
 */
export async function responsableAutomatico(
  sb: AppSupabaseClient,
  empresaId: string,
  tipoCodigo: string,
  ahora: number = Date.now()
): Promise<AsignacionAutomatica> {
  const fijo = RESPONSABLE_HORARIO_LABORAL[empresaId] ?? null;
  if (tipoCodigo !== "error" || enHorarioLaboral(ahora) || !enFranjaDeGuardia(ahora)) {
    return { responsableId: fijo, motivo: "ordinario" };
  }

  // El día en Paraguay, para saber a qué semana de guardia pertenece.
  const diaPy = new Date(ahora + TZ_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
  const [{ data }, equipo] = await Promise.all([
    sb.from("guardias_semana").select("soporte_principal_id").eq("empresa_id", empresaId).eq("semana_inicio", lunesDe(diaPy)).maybeSingle(),
    personasDeEmpresa(empresaId),
  ]);
  const principal = (data as { soporte_principal_id?: string | null } | null)?.soporte_principal_id ?? null;
  if (principal && equipo.some((p) => p.id === principal && puedeEstarACargo(p))) {
    return { responsableId: principal, motivo: "guardia" };
  }
  return { responsableId: fijo, motivo: "guardia_sin_asignar" };
}

export function gestionDeTipoTicket(tipoCodigo: unknown): TipoGestion | null {
  const par = Object.entries(TIPO_TICKET_DE_GESTION).find(([, t]) => t === tipoCodigo);
  return (par?.[0] as TipoGestion | undefined) ?? null;
}

/**
 * Asunto del ticket, sacado de la descripción: su primera línea, cortada en
 * una palabra. Quien carga ya no escribe un asunto aparte.
 */
export function asuntoDesdeDescripcion(descripcion: unknown, max = 90): string {
  const texto = typeof descripcion === "string" ? descripcion.trim() : "";
  const linea = texto.split(/\r?\n/).find((l) => l.trim())?.trim().replace(/\s+/g, " ") ?? "";
  if (linea.length <= max) return linea;
  const corte = linea.slice(0, max);
  const espacio = corte.lastIndexOf(" ");
  return `${(espacio > max * 0.6 ? corte.slice(0, espacio) : corte).trim()}…`;
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

  const asignacion = await responsableAutomatico(soporte.sb, soporte.empresaId, tipoCodigo);
  const prep = await prepararTicket(
    soporte,
    {
      ...args.datosTicket,
      asunto: asuntoDesdeDescripcion(args.datosTicket.descripcion),
      cliente_id: args.clienteId,
      tipo_codigo: tipoCodigo,
      prioridad_codigo: args.datosTicket.prioridad_codigo ?? "normal",
      responsable_id: asignacion.responsableId,
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
      metadataExtra: {
        origen: args.origen,
        tipificacion_id: r.tipificacion_id,
        conversation_id: args.conversationId ?? null,
        asignacion: asignacion.motivo,
      },
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

  // Aviso en la campanita a quien le cayó el ticket (no-throwing; si lo cargó
  // la misma persona no se avisa).
  const clienteNombre = (await clientesPorId(soporte.sb, soporte.empresaId, [args.clienteId])).get(args.clienteId) ?? "Cliente";
  await avisarSoporte(soporte, {
    usuarioId: prep.ticket.fila.responsable_id,
    titulo: `Nuevo ticket ${numeroTicket(r.numero)} · ${tipoNombre}${prep.ticket.resumen.clasificacion_nombre ? ` ${prep.ticket.resumen.clasificacion_nombre}` : ""}${
      asignacion.motivo === "guardia" ? " (guardia)" : ""
    }`,
    cuerpo: `${clienteNombre} · ${prep.ticket.fila.asunto}`,
    ticketId: r.ticket_id,
  });

  return { ok: true, tipificacion_id: r.tipificacion_id, ticket_id: r.ticket_id, numero: r.numero };
}
