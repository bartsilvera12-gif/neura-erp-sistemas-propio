import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import {
  RESULTADOS_TIPIFICACION,
  TIPOS_GESTION,
  type TicketDeTipificacion,
} from "@/lib/gestion-clientes/types";
import { getUserAndEmpresa } from "@/lib/middleware/auth";
import { requireCargaSoporteApi } from "@/lib/soporte/soporte-auth";
import { errorInesperado, falla, leerCatalogos, ok, personasPorId } from "@/lib/soporte/servidor";
import { TIPO_TICKET_DE_GESTION, crearTipificacionConTicket } from "@/lib/soporte/tipificacion-ticket";

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
    .select("id")
    .eq("empresa_id", auth.empresa_id)
    .eq("id", clienteId)
    .maybeSingle();
  if (!cliente) return { ok: false as const, respuesta: falla("Cliente no encontrado", 404) };

  const usuarioId = auth.usuarioCatalogId ?? null;
  const persona = usuarioId ? (await personasPorId([usuarioId])).get(usuarioId) : undefined;
  const nombre = persona?.nombre?.trim() || auth.user.email || "Usuario";
  return { ok: true as const, auth, sb, clienteId, usuario: { id: usuarioId, nombre } };
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

    return ok({
      usuario_actual: usuario,
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
    const { auth, sb, clienteId, usuario } = ctx;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return falla("Datos inválidos");

    const tipo = TIPOS_GESTION.find((t) => t === body.tipo_gestion);
    if (!tipo) return falla("Tipo de gestión inválido");
    const observacion = typeof body.observacion === "string" ? body.observacion.trim().slice(0, 5000) : "";
    if (!observacion) return falla("La observación es obligatoria.");

    // ---------------------------------------------------------------- normal
    if (!TIPO_TICKET_DE_GESTION[tipo]) {
      const resultado = RESULTADOS_TIPIFICACION.find((r) => r === body.resultado);
      if (!resultado) return falla("Resultado inválido");
      const { data, error } = await sb
        .from("tipificaciones")
        .insert({
          empresa_id: auth.empresa_id,
          cliente_id: clienteId,
          usuario: usuario.nombre,
          usuario_id: usuario.id,
          tipo_gestion: tipo,
          resultado,
          observacion,
        })
        .select("id")
        .single();
      if (error || !data) return falla(error?.message ?? "Error al guardar la tipificación.");
      return ok({ tipificacion_id: data.id, ticket: null });
    }

    // ------------------------------------------------------ Error / Cambio
    const soporte = await requireCargaSoporteApi(request);
    if (!soporte.ok) {
      return falla(
        soporte.status === 401 ? soporte.message : "Tu usuario no puede cargar tickets de Soporte.",
        soporte.status
      );
    }
    if (soporte.empresaId !== auth.empresa_id) return falla("Empresa inconsistente", 403);

    const datosTicket = body.ticket && typeof body.ticket === "object" ? (body.ticket as Record<string, unknown>) : null;
    if (!datosTicket) return falla("Completá los datos del ticket de soporte.");

    const r = await crearTipificacionConTicket(soporte, {
      clienteId,
      tipoGestion: tipo,
      observacion,
      usuario,
      authUser: { id: auth.user.id, email: auth.user.email ?? null },
      datosTicket,
      exigirProyecto: true,
      origen: "tipificacion_cliente",
    });
    if (!r.ok) return falla(r.mensaje, r.status);

    return ok({ tipificacion_id: r.tipificacion_id, ticket: { id: r.ticket_id, numero: r.numero } });
  } catch (e) {
    return errorInesperado(e);
  }
}
