import { getAuthUserForApiRoute } from "@/lib/auth/get-auth-user-for-api-route";
import { registrarHistorialCliente } from "@/lib/clientes/historial";
import { puedeEstarACargo } from "@/lib/soporte/dominio";
import { prepararTicket, registrarAltaTicket } from "@/lib/soporte/crear-ticket";
import { requireCargaSoporteApi } from "@/lib/soporte/soporte-auth";
import {
  clientesDeEmpresa,
  errorInesperado,
  falla,
  leerCatalogos,
  ok,
  personasDeEmpresa,
  personasPorId,
  sinPermiso,
} from "@/lib/soporte/servidor";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Carga de un ticket de Soporte desde Conversaciones.
 *
 * La usan los Project Managers (y quien ya usa Soporte) sin salir del chat.
 * Tiene su propio permiso (`requireCargaSoporteApi`): sirve para CREAR un
 * ticket, no abre listados, edición ni configuración del módulo.
 *
 * GET ?verificar=1   → { puede: true } o 403, para mostrar el botón.
 * GET                → lo necesario para el formulario (tipos, niveles, clientes,
 *                      quiénes pueden quedar a cargo). 403 si no puede cargar:
 *                      la pantalla usa eso para mostrar o no el botón.
 * GET ?cliente_id=…  → proyectos de ese cliente.
 * POST               → crea el ticket y lo deja en el historial del cliente.
 */
export async function GET(request: Request) {
  const auth = await requireCargaSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  try {
    const params = new URL(request.url).searchParams;
    // Sólo saber si puede cargar (para mostrar el botón), sin traer nada más.
    if (params.get("verificar") === "1") return ok({ puede: true });
    const clienteId = params.get("cliente_id");
    if (clienteId) {
      if (!UUID.test(clienteId)) return falla("cliente_id inválido");
      const { data, error } = await auth.sb
        .from("proyectos")
        .select("id, titulo")
        .eq("empresa_id", auth.empresaId)
        .eq("cliente_id", clienteId)
        .eq("archivado", false)
        .order("titulo");
      if (error) return falla(error.message);
      return ok({ proyectos: data ?? [] });
    }

    const [cat, personas, clientes] = await Promise.all([
      leerCatalogos(auth.sb, auth.empresaId),
      personasDeEmpresa(auth.empresaId),
      clientesDeEmpresa(auth.sb, auth.empresaId),
    ]);
    return ok({
      tipos: cat.tipos.filter((t) => t.activo),
      clasificaciones: cat.clasificaciones.filter((c) => c.activo),
      a_cargo: personas.filter(puedeEstarACargo),
      clientes,
    });
  } catch (e) {
    return errorInesperado(e);
  }
}

export async function POST(request: Request) {
  const auth = await requireCargaSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return falla("Datos inválidos");

    const conversationId = typeof body.conversation_id === "string" && UUID.test(body.conversation_id) ? body.conversation_id : null;
    if (conversationId) {
      const { data: conv } = await auth.sb
        .from("chat_conversations")
        .select("id")
        .eq("empresa_id", auth.empresaId)
        .eq("id", conversationId)
        .maybeSingle();
      if (!conv) return falla("La conversación no existe", 404);
    }

    // Mismas reglas que el alta de Soporte: cliente y proyecto de la empresa,
    // catálogo, a cargo sólo Desarrollo o QA, SLA y fecha de entrega.
    const prep = await prepararTicket(auth, {
      cliente_id: body.cliente_id,
      proyecto_id: body.proyecto_id,
      tipo_codigo: body.tipo_codigo,
      clasificacion_codigo: body.clasificacion_codigo,
      prioridad_codigo: "normal",
      asunto: body.asunto,
      descripcion: body.descripcion,
      responsable_id: body.responsable_id,
    });
    if (!prep.ok) return falla(prep.mensaje, prep.status);

    const { data: creado, error } = await auth.sb
      .from("soporte_tickets")
      .insert({ ...prep.ticket.fila, origen: "manual" })
      .select("id, numero")
      .single();
    if (error || !creado) return falla(error?.message ?? "No se pudo crear el ticket");
    const ticketId = creado.id as string;
    const numero = creado.numero as number;

    const [authUser, personas] = await Promise.all([
      getAuthUserForApiRoute(request).catch(() => null),
      personasPorId([auth.usuarioId]),
    ]);
    const cat = await leerCatalogos(auth.sb, auth.empresaId);
    const tipo = cat.tipos.find((t) => t.codigo === prep.ticket.fila.tipo_codigo)?.nombre ?? prep.ticket.fila.tipo_codigo;

    await Promise.all([
      registrarAltaTicket(auth, {
        ticketId,
        numero,
        ticket: prep.ticket,
        metadataExtra: { origen: "conversacion", conversation_id: conversationId },
      }),
      registrarHistorialCliente(auth.sb, {
        empresaId: auth.empresaId,
        clienteId: prep.ticket.fila.cliente_id,
        tipo: "soporte",
        accion: "ticket_created",
        authUserId: authUser?.id ?? null,
        email: authUser?.email ?? null,
        source: "conversacion",
        detalle: {
          ticket_id: ticketId,
          ticket_numero: numero,
          conversation_id: conversationId,
          proyecto_id: prep.ticket.fila.proyecto_id,
          proyecto_nombre: prep.ticket.resumen.proyecto_titulo,
          asunto: prep.ticket.fila.asunto,
          tipo,
          clasificacion: prep.ticket.resumen.clasificacion_nombre,
          estado: prep.ticket.resumen.estado_nombre,
          sla_horas: prep.ticket.fila.sla_horas,
          fecha_objetivo: prep.ticket.fila.fecha_objetivo,
          usuario: personas.get(auth.usuarioId)?.nombre ?? null,
        },
      }),
    ]);

    return ok({ id: ticketId, numero });
  } catch (e) {
    return errorInesperado(e);
  }
}
