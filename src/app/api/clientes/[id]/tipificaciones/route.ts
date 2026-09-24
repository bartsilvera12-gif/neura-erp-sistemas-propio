import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import {
  type TicketDeTipificacion,
  type TipoGestion,
} from "@/lib/gestion-clientes/types";
import { getUserAndEmpresa } from "@/lib/middleware/auth";
import { TIPO_CITA_CAPACITACION, agendarCapacitacion, leerAgendaCapacitacion } from "@/lib/agenda/capacitacion";
import { nombreClienteDisplay } from "@/lib/clientes/display-name";
import { requireCargaSoporteApi } from "@/lib/soporte/soporte-auth";
import { errorInesperado, falla, leerCatalogos, ok, personasDeEmpresa, personasPorId } from "@/lib/soporte/servidor";
import { crearTipificacionConTicket } from "@/lib/soporte/tipificacion-ticket";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Contexto común: usuario autenticado (resuelto en el servidor, nunca desde el
 * body), cliente de SU empresa y cliente del schema de datos de la empresa.
 */
async function contexto(request: Request, params: Promise<{ id: string }>) {
  const auth = await getUserAndEmpresa(request);
  if (!auth) return { ok: false as const, respuesta: falla("No autenticado", 401) };
  const { id } = await params;
  const clienteId = id?.trim() ?? "";
  if (!UUID.test(clienteId)) return { ok: false as const, respuesta: falla("Cliente inválido") };

  const sb = await getChatServiceClientForEmpresa(auth.empresa_id);
  const { data: cliente } = await sb
    .from("clientes")
    .select("id, empresa, nombre, nombre_contacto, razon_social, tipo_cliente")
    .eq("empresa_id", auth.empresa_id)
    .eq("id", clienteId)
    .maybeSingle();
  if (!cliente) return { ok: false as const, respuesta: falla("Cliente no encontrado", 404) };
  const clienteNombre = nombreClienteDisplay(cliente as never);

  const usuarioId = auth.usuarioCatalogId ?? null;
  const persona = usuarioId ? (await personasPorId([usuarioId])).get(usuarioId) : undefined;
  const nombre = persona?.nombre?.trim() || auth.user.email || "Usuario";
  return { ok: true as const, auth, sb, clienteId, clienteNombre, usuario: { id: usuarioId, nombre }, esPm: persona?.es_project_manager === true };
}

/**
 * GET /api/clientes/:id/tipificaciones
 *
 * Historial de tipificaciones del cliente. Las que generaron un ticket traen su
 * número, estado, prioridad y proyecto (resueltos en vivo desde Soporte: el
 * estado es el de ahora, no una copia). `puede_soporte` dice si quien consulta
 * puede abrir el ticket o escalar un Error.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await contexto(request, params);
    if (!ctx.ok) return ctx.respuesta;
    const { auth, sb, clienteId, usuario } = ctx;

    const [{ data: filas, error }, soporte] = await Promise.all([
      sb
        .from("tipificaciones")
        .select("id, cliente_id, fecha, usuario, usuario_id, tipo_gestion, resultado, observacion")
        .eq("empresa_id", auth.empresa_id)
        .eq("cliente_id", clienteId)
        .order("fecha", { ascending: false })
        .limit(500),
      requireCargaSoporteApi(request),
    ]);
    if (error) return falla(error.message);
    const lista = (filas ?? []) as Record<string, unknown>[];

    const ids = lista.map((f) => String(f.id));
    const tickets = new Map<string, TicketDeTipificacion>();
    if (ids.length) {
      const { data: tks } = await sb
        .from("soporte_tickets")
        .select("id, numero, asunto, estado_codigo, prioridad_codigo, proyecto_id, tipificacion_id")
        .eq("empresa_id", auth.empresa_id)
        .eq("cliente_id", clienteId)
        .not("tipificacion_id", "is", null);
      const vinculados = ((tks ?? []) as Record<string, unknown>[]).filter((t) => ids.includes(String(t.tipificacion_id)));
      if (vinculados.length) {
        const proyectoIds = [...new Set(vinculados.map((t) => t.proyecto_id).filter(Boolean))] as string[];
        const [cat, { data: prs }] = await Promise.all([
          leerCatalogos(sb, auth.empresa_id),
          proyectoIds.length
            ? sb.from("proyectos").select("id, titulo").eq("empresa_id", auth.empresa_id).in("id", proyectoIds)
            : Promise.resolve({ data: [] as { id: string; titulo: string }[] }),
        ]);
        const titulos = new Map(((prs ?? []) as { id: string; titulo: string }[]).map((p) => [p.id, p.titulo]));
        for (const t of vinculados) {
          const estado = cat.estados.find((e) => e.codigo === t.estado_codigo);
          const prioridad = cat.prioridades.find((p) => p.codigo === t.prioridad_codigo);
          tickets.set(String(t.tipificacion_id), {
            id: String(t.id),
            numero: Number(t.numero),
            asunto: String(t.asunto ?? ""),
            estado_codigo: String(t.estado_codigo),
            estado_nombre: estado?.nombre ?? String(t.estado_codigo),
            estado_color: estado?.color ?? null,
            prioridad_codigo: String(t.prioridad_codigo),
            prioridad_nombre: prioridad?.nombre ?? String(t.prioridad_codigo),
            proyecto_id: (t.proyecto_id as string | null) ?? null,
            proyecto_titulo: t.proyecto_id ? titulos.get(String(t.proyecto_id)) ?? null : null,
          });
        }
      }
    }

    // Capacitaciones agendadas desde una tipificación (si la empresa tiene Agenda).
    const citas = new Map<string, { id: string; inicio_at: string; fin_at: string; estado: string; responsable: string | null }>();
    if (ids.length) {
      const { data: cs } = await sb
        .from("agenda_citas")
        .select("id, inicio_at, fin_at, estado, responsable_id, metadata")
        .eq("empresa_id", auth.empresa_id)
        .eq("cliente_id", clienteId)
        .eq("tipo", TIPO_CITA_CAPACITACION);
      const filasCita = ((cs ?? []) as { id: string; inicio_at: string; fin_at: string; estado: string; responsable_id: string | null; metadata: Record<string, unknown> | null }[])
        .filter((c) => typeof c.metadata?.tipificacion_id === "string" && ids.includes(String(c.metadata.tipificacion_id)));
      const nombres = await personasPorId(filasCita.map((c) => c.responsable_id));
      for (const c of filasCita) {
        citas.set(String(c.metadata?.tipificacion_id), {
          id: c.id,
          inicio_at: c.inicio_at,
          fin_at: c.fin_at,
          estado: c.estado,
          responsable: c.responsable_id ? nombres.get(c.responsable_id)?.nombre ?? null : null,
        });
      }
    }
    const equipo = (await personasDeEmpresa(auth.empresa_id)).map((p) => ({ id: p.id, nombre: p.nombre, area: p.area }));

    return ok({
      usuario_actual: usuario,
      // Los PM ven primero Error y Cambio: es lo que más cargan.
      es_pm: ctx.esPm,
      equipo,
      puede_soporte: soporte.ok,
      tipificaciones: lista.map((f) => ({
        id: String(f.id),
        cliente_id: String(f.cliente_id),
        fecha: String(f.fecha),
        usuario: String(f.usuario ?? ""),
        usuario_id: (f.usuario_id as string | null) ?? null,
        tipo_gestion: f.tipo_gestion,
        resultado: f.resultado,
        observacion: String(f.observacion ?? ""),
        ticket: tickets.get(String(f.id)) ?? null,
        cita: citas.get(String(f.id)) ?? null,
      })),
    });
  } catch (e) {
    return errorInesperado(e);
  }
}

/**
 * POST /api/clientes/:id/tipificaciones
 *
 * Body: { tipo_gestion, resultado, observacion, ticket? }
 *
 * · Tipos normales: se guarda la tipificación con el usuario real. Igual que antes.
 * · Capacitación con `agenda` { inicio, duracion_min, responsable_id, ubicacion? }:
 *   además se agenda la sesión en Agenda, vinculada al cliente.
 * · Error y Cambio: crean su ticket de Soporte (ver `crearTipificacionConTicket`).
 *   Pueden los PM y quien usa Soporte. La tipificación y el ticket se crean en UNA
 *   transacción SQL: o quedan los dos, o ninguno. El resultado se fija en "Escalar".
 *
 * Las credenciales del proyecto NUNCA viajan ni se guardan acá: el ticket guarda
 * `proyecto_id` y se consultan desde el proyecto con sus propios permisos.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await contexto(request, params);
    if (!ctx.ok) return ctx.respuesta;
    const { auth, sb, clienteId, clienteNombre, usuario } = ctx;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return falla("Datos inválidos");

    const observacion = typeof body.observacion === "string" ? body.observacion.trim().slice(0, 5000) : "";
    if (!observacion) return falla("La observación es obligatoria.");

    // Modelo por catálogo: Estado (tipificacion_familias) + Sub-estado
    // (tipificacion_estados). El Sub-estado elegido puede tener una ACCIÓN
    // (comportamiento) que crea un ticket o agenda una capacitación.
    const estadoId = typeof body.estado_id === "string" ? body.estado_id.trim() : "";
    const subestadoId = typeof body.subestado_id === "string" ? body.subestado_id.trim() : "";
    if (!UUID.test(estadoId) || !UUID.test(subestadoId)) return falla("Elegí el estado y el sub-estado.");

    const [estRes, subRes] = await Promise.all([
      sb.from("tipificacion_familias").select("id, nombre").eq("empresa_id", auth.empresa_id).eq("id", estadoId).maybeSingle(),
      sb.from("tipificacion_estados").select("id, nombre, comportamiento, familia_id").eq("empresa_id", auth.empresa_id).eq("id", subestadoId).maybeSingle(),
    ]);
    const estado = estRes.data as { id: string; nombre: string } | null;
    const sub = subRes.data as { id: string; nombre: string; comportamiento: string | null; familia_id: string } | null;
    if (!estado) return falla("El estado no existe.");
    if (!sub || sub.familia_id !== estadoId) return falla("El sub-estado no corresponde al estado elegido.");

    // El histórico muestra "Tipo/Resultado": guardamos Estado en tipo_gestion y
    // Sub-estado en resultado; los ids quedan para la reportería.
    const tipoGestionTxt = estado.nombre;
    const resultadoTxt = sub.nombre;
    const comportamiento = (sub.comportamiento ?? "").trim();

    // ------------------------------------------ Sub-estado que crea ticket
    if (comportamiento === "ticket_error" || comportamiento === "ticket_cambio") {
      const soporte = await requireCargaSoporteApi(request);
      if (!soporte.ok) {
        return falla(soporte.status === 401 ? soporte.message : "Tu usuario no puede cargar tickets de Soporte.", soporte.status);
      }
      if (soporte.empresaId !== auth.empresa_id) return falla("Empresa inconsistente", 403);
      const datosTicket = body.ticket && typeof body.ticket === "object" ? (body.ticket as Record<string, unknown>) : null;
      if (!datosTicket) return falla("Completá los datos del ticket de soporte.");

      // El motor de tickets espera "Error"/"Cambio" para elegir el tipo de ticket.
      const tipoTicket: TipoGestion = comportamiento === "ticket_error" ? "Error" : "Cambio";
      const r = await crearTipificacionConTicket(soporte, {
        clienteId,
        tipoGestion: tipoTicket,
        observacion,
        usuario,
        authUser: { id: auth.user.id, email: auth.user.email ?? null },
        datosTicket,
        exigirProyecto: true,
        origen: "tipificacion_cliente",
      });
      if (!r.ok) return falla(r.mensaje, r.status);
      // La tipificación nace con tipo_gestion="Error"/"Cambio" y resultado="Escalar";
      // se sobreescribe con los valores del catálogo (Estado/Sub-estado) + ids para
      // que se muestre y reporte igual que el resto. El ticket ya quedó vinculado.
      await sb
        .from("tipificaciones")
        .update({ tipo_gestion: tipoGestionTxt, resultado: resultadoTxt, familia_id: estadoId, estado_id: subestadoId })
        .eq("empresa_id", auth.empresa_id)
        .eq("id", r.tipificacion_id);
      return ok({ tipificacion_id: r.tipificacion_id, ticket: { id: r.ticket_id, numero: r.numero } });
    }

    // ----------------------- Sub-estado que agenda capacitación (o normal)
    // La cita se crea ANTES (valida horario y choque); si la tipificación no se
    // guarda después, la cita se borra.
    let citaId: string | null = null;
    if (comportamiento === "capacitacion" && body.agenda) {
      const equipo = await personasDeEmpresa(auth.empresa_id);
      const leida = leerAgendaCapacitacion(body.agenda, equipo);
      if (!leida.ok) return falla(leida.mensaje);
      const cita = await agendarCapacitacion(sb, {
        empresaId: auth.empresa_id,
        clienteId,
        clienteNombre,
        agenda: leida.agenda,
        observaciones: observacion,
        creadoPor: usuario.id,
      });
      if (!cita.ok) return falla(cita.mensaje, cita.status);
      citaId = cita.id;
    }

    const { data, error } = await sb
      .from("tipificaciones")
      .insert({
        empresa_id: auth.empresa_id,
        cliente_id: clienteId,
        usuario: usuario.nombre,
        usuario_id: usuario.id,
        tipo_gestion: tipoGestionTxt,
        resultado: resultadoTxt,
        observacion,
        familia_id: estadoId,
        estado_id: subestadoId,
      })
      .select("id")
      .single();
    if (error || !data) {
      if (citaId) await sb.from("agenda_citas").delete().eq("empresa_id", auth.empresa_id).eq("id", citaId);
      return falla(error?.message ?? "Error al guardar la tipificación.");
    }
    if (citaId) {
      await sb
        .from("agenda_citas")
        .update({ metadata: { origen: "tipificacion", tipificacion_id: data.id } })
        .eq("empresa_id", auth.empresa_id)
        .eq("id", citaId);
    }
    return ok({ tipificacion_id: data.id, ticket: null, cita_id: citaId });
  } catch (e) {
    return errorInesperado(e);
  }
}
