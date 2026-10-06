import { NextRequest, NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { requireEmpresaTenantServiceRole } from "@/lib/chat/empresa-tenant-service-role";
import { filterConversationIdsByOmnicanalScope } from "@/lib/chat/omnicanal-scope";

/**
 * GET /api/chat/mobile-inbox
 *
 * Endpoint LIVIANO para el inbox mobile. Devuelve hasta 50 conversaciones
 * abiertas/pendientes con contacto enriquecido para mostrar en la lista mobile.
 * No usa el bootstrap pesado del desktop ConversacionesClient.
 *
 * Devuelve:
 *   { conversations: [{ id, status, last_message_at, last_message_preview,
 *                       unread_count, contact_nombre, contact_telefono, channel_name }] }
 */
export async function GET(request: NextRequest) {
  try {
    let ctx;
    try {
      ctx = await requireEmpresaTenantServiceRole(request);
    } catch {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { supabase, catalogSr, empresa_id: empresaId, usuario_id: usuarioId } = ctx;

    const onlyOpen = request.nextUrl.searchParams.get("only_open") !== "0";
    const statusList = onlyOpen ? ["open", "pending"] : ["open", "pending", "closed"];

    /**
     * Paginado. `offset` es cuántas conversaciones ya tiene el cliente.
     *
     * Antes devolvía 50 y no había forma de pedir las siguientes: una empresa
     * con cientos de conversaciones abiertas veía sólo las 50 más recientes y
     * el resto no existía para la app.
     */
    const pedido = Number(request.nextUrl.searchParams.get("limit") ?? 50);
    const limite = Number.isFinite(pedido) ? Math.min(Math.max(Math.trunc(pedido), 1), 100) : 50;
    const crudoOffset = Number(request.nextUrl.searchParams.get("offset") ?? 0);
    const offset = Number.isFinite(crudoOffset) ? Math.max(Math.trunc(crudoOffset), 0) : 0;

    type Row = {
      id: string;
      status: string;
      last_message_at: string | null;
      last_message_preview: string | null;
      unread_count: number | null;
      contact_id: string | null;
      channel_id: string | null;
      assigned_agent_id: string | null;
      queue_id: string | null;
    };

    // Candidatas (ventana amplia) ordenadas por actividad. El scope omnicanal se aplica con el
    // mismo helper que el desktop (admin=bypass; agente=asignadas a él + sin-asignar de su cola),
    // y recién después se recorta. Antes este endpoint NO aplicaba scope (sobre-exposición).
    //
    // La ventana se pide en función del offset porque el filtro de scope corre
    // acá y no en la base: hay que traer de más para que, después de descartar
    // lo que esta persona no puede ver, siga alcanzando para la página pedida.
    const ventana = Math.min(offset + limite * 4, 1000);
    const { data: convs, error } = await supabase
      .from("chat_conversations")
      .select(
        "id, status, last_message_at, last_message_preview, unread_count, contact_id, channel_id, assigned_agent_id, queue_id"
      )
      .eq("empresa_id", empresaId)
      .in("status", statusList)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(ventana);

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }

    const candidatas = (convs ?? []) as Row[];
    const visibles = await filterConversationIdsByOmnicanalScope(
      supabase,
      catalogSr,
      empresaId,
      usuarioId,
      candidatas.map((r) => r.id)
    );
    const enAlcance = candidatas.filter((r) => visibles.has(r.id));
    const rows = enAlcance.slice(offset, offset + limite);
    // `hay_mas` sale de lo que quedó después del scope, no del total de la
    // tabla: decirle a la app que hay más y después devolverle vacío es peor
    // que no ofrecer el botón.
    const hayMas = enAlcance.length > offset + limite;

    const contactIds = [...new Set(rows.map((r) => r.contact_id).filter((id): id is string => !!id))];
    const channelIds = [...new Set(rows.map((r) => r.channel_id).filter((id): id is string => !!id))];
    const agentIds = [...new Set(rows.map((r) => r.assigned_agent_id).filter((id): id is string => !!id))];
    const queueIds = [...new Set(rows.map((r) => r.queue_id).filter((id): id is string => !!id))];

    const [contactsRes, channelsRes, agentsRes, queuesRes] = await Promise.all([
      contactIds.length > 0
        ? supabase
            .from("chat_contacts")
            // Las columnas son `name` y `phone_number`. Decía `nombre, telefono,
            // raw_telefono`: PostgREST devolvía error, el error se descartaba
            // más abajo con `?? []`, y el inbox mobile mostraba "Sin nombre" en
            // todas las conversaciones sin que nada quedara registrado.
            .select("id, name, phone_number, phone_normalized")
            .eq("empresa_id", empresaId)
            .in("id", contactIds)
        : Promise.resolve({ data: [], error: null } as { data: unknown[]; error: null }),
      channelIds.length > 0
        ? supabase
            .from("chat_channels")
            // Misma historia: la columna es `nombre`, no `name`.
            .select("id, nombre, provider")
            .eq("empresa_id", empresaId)
            .in("id", channelIds)
        : Promise.resolve({ data: [], error: null } as { data: unknown[]; error: null }),
      // `chat_agents` guarda a quién pertenece la conversación, pero por
      // `usuario_id`: el nombre está en el catálogo, un paso más allá.
      agentIds.length > 0
        ? supabase
            .from("chat_agents")
            .select("id, usuario_id")
            .eq("empresa_id", empresaId)
            .in("id", agentIds)
        : Promise.resolve({ data: [], error: null } as { data: unknown[]; error: null }),
      queueIds.length > 0
        ? supabase
            .from("chat_queues")
            .select("id, nombre")
            .eq("empresa_id", empresaId)
            .in("id", queueIds)
        : Promise.resolve({ data: [], error: null } as { data: unknown[]; error: null }),
    ]);

    // Un error acá no corta el inbox —las conversaciones se muestran igual, sin
    // nombre— pero tiene que quedar en el log. Descartarlo en silencio es lo que
    // hizo que una columna mal escrita pasara desapercibida.
    if (contactsRes.error) {
      console.warn("[mobile-inbox] no se pudieron leer los contactos:", contactsRes.error.message);
    }
    if (channelsRes.error) {
      console.warn("[mobile-inbox] no se pudieron leer los canales:", channelsRes.error.message);
    }
    if (agentsRes.error) {
      console.warn("[mobile-inbox] no se pudieron leer los agentes:", agentsRes.error.message);
    }
    if (queuesRes.error) {
      console.warn("[mobile-inbox] no se pudieron leer las colas:", queuesRes.error.message);
    }

    // agente -> usuario, y después usuario -> nombre, que vive en el catálogo.
    const usuarioPorAgente = new Map<string, string>();
    for (const a of (agentsRes.data ?? []) as Array<{ id: string; usuario_id: string | null }>) {
      if (a.usuario_id) usuarioPorAgente.set(a.id, a.usuario_id);
    }
    const nombrePorUsuario = new Map<string, string>();
    const usuarioIds = [...new Set(usuarioPorAgente.values())];
    if (usuarioIds.length > 0) {
      const { data: us, error: uErr } = await catalogSr
        .from("usuarios")
        .select("id, nombre")
        .in("id", usuarioIds);
      if (uErr) {
        console.warn("[mobile-inbox] no se pudieron leer los usuarios:", uErr.message);
      }
      for (const u of (us ?? []) as Array<{ id: string; nombre: string | null }>) {
        if (u.nombre) nombrePorUsuario.set(u.id, u.nombre);
      }
    }

    const colaPorId = new Map<string, string>();
    for (const q of (queuesRes.data ?? []) as Array<{ id: string; nombre: string | null }>) {
      if (q.nombre) colaPorId.set(q.id, q.nombre);
    }

    const contactById = new Map<string, { nombre: string | null; telefono: string | null }>();
    for (const c of (contactsRes.data ?? []) as Array<{
      id: string;
      name: string | null;
      phone_number: string | null;
      phone_normalized: string | null;
    }>) {
      contactById.set(c.id, {
        nombre: c.name ?? null,
        telefono: c.phone_number ?? c.phone_normalized ?? null,
      });
    }

    const channelById = new Map<string, { name: string | null; provider: string | null }>();
    for (const c of (channelsRes.data ?? []) as Array<{
      id: string;
      nombre: string | null;
      provider: string | null;
    }>) {
      channelById.set(c.id, { name: c.nombre ?? null, provider: c.provider ?? null });
    }

    const conversations = rows.map((r) => {
      const contact = r.contact_id ? contactById.get(r.contact_id) : null;
      const channel = r.channel_id ? channelById.get(r.channel_id) : null;
      return {
        id: r.id,
        status: r.status,
        last_message_at: r.last_message_at,
        last_message_preview: r.last_message_preview,
        unread_count: Number(r.unread_count ?? 0),
        contact_nombre: contact?.nombre ?? null,
        contact_telefono: contact?.telefono ?? null,
        channel_name: channel?.name ?? null,
        channel_provider: channel?.provider ?? null,
        // De quién es la conversación. Sin esto, en una lista larga no se sabe
        // cuál está atendiendo cada uno y dos personas contestan lo mismo.
        agente_nombre: r.assigned_agent_id
          ? (nombrePorUsuario.get(usuarioPorAgente.get(r.assigned_agent_id) ?? "") ?? null)
          : null,
        cola_nombre: r.queue_id ? (colaPorId.get(r.queue_id) ?? null) : null,
      };
    });

    return NextResponse.json(successResponse({ conversations, hay_mas: hayMas, offset, limit: limite }), {
      headers: {
        // El cliente revalida con polling de 30s; permitimos servir cached con SWR.
        "Cache-Control": "private, max-age=0, stale-while-revalidate=15",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
