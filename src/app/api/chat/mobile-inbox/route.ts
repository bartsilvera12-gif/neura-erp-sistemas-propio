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
 *                       unread_count, contact_nombre, contact_telefono, channel_name,
 *                       cola_nombre }], hay_mas }
 *
 * Paginado con `offset` y `limit` (tope 100). Sin ellos se comporta como antes.
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
     * el resto no existía para la app. Ni siquiera buscando, porque el buscador
     * filtra lo que ya está cargado.
     *
     * Sin parámetros se comporta igual que antes: offset 0 y 50 por tanda.
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
      queue_id: string | null;
    };

    // Candidatas (ventana amplia) ordenadas por actividad. El scope omnicanal se aplica con el
    // mismo helper que el desktop (admin=bypass; agente=asignadas a él + sin-asignar de su cola),
    // y recién después se recorta. Antes este endpoint NO aplicaba scope (sobre-exposición).
    //
    // La ventana crece con el offset porque el filtro de alcance corre acá y no
    // en la consulta: hay que traer de más para que, después de descartar lo
    // que esta persona no puede ver, siga alcanzando para la página pedida.
    // Con los valores por defecto da 200, que es lo que pedía antes.
    const { data: convs, error } = await supabase
      .from("chat_conversations")
      .select(
        "id, status, last_message_at, last_message_preview, unread_count, contact_id, channel_id, queue_id"
      )
      .eq("empresa_id", empresaId)
      .in("status", statusList)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(Math.min(offset + limite * 4, 1000));

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
    // `hay_mas` sale de lo que quedó DESPUÉS del alcance, no del total de la
    // tabla: ofrecer "cargar más" y después devolver vacío es peor que no
    // ofrecerlo.
    const hayMas = enAlcance.length > offset + limite;

    const contactIds = [...new Set(rows.map((r) => r.contact_id).filter((id): id is string => !!id))];
    const channelIds = [...new Set(rows.map((r) => r.channel_id).filter((id): id is string => !!id))];
    const queueIds = [...new Set(rows.map((r) => r.queue_id).filter((id): id is string => !!id))];

    const [contactsRes, channelsRes, queuesRes] = await Promise.all([
      contactIds.length > 0
        ? supabase
            .from("chat_contacts")
            // Las columnas se llaman `name` y `phone_number`. Decía `nombre,
            // telefono, raw_telefono`: PostgREST devolvía error, el error se
            // descartaba con el `?? []` de abajo, el mapa quedaba vacío y toda
            // conversación salía con `contact_nombre: null`. En la app móvil se
            // veía "Sin nombre" en todas, sin que quedara rastro de por qué.
            .select("id, name, phone_number, phone_normalized")
            .eq("empresa_id", empresaId)
            .in("id", contactIds)
        : Promise.resolve({ data: [], error: null } as { data: unknown[]; error: null }),
      channelIds.length > 0
        ? supabase
            .from("chat_channels")
            .select("id, name, provider")
            .eq("empresa_id", empresaId)
            .in("id", channelIds)
        : Promise.resolve({ data: [], error: null } as { data: unknown[]; error: null }),
      // La cola de atención, para que la app pueda dividir el inbox en
      // pestañas como el escritorio. Sólo el nombre de las colas que
      // aparecen en esta página, no el catálogo entero.
      queueIds.length > 0
        ? supabase
            .from("chat_queues")
            .select("id, nombre")
            .eq("empresa_id", empresaId)
            .in("id", queueIds)
        : Promise.resolve({ data: [], error: null } as { data: unknown[]; error: null }),
    ]);

    // Un error acá no corta el inbox —las conversaciones se listan igual, sin
    // nombre— pero tiene que quedar en el log. Descartarlo en silencio es lo
    // que hizo que una columna mal escrita pasara meses desapercibida.
    if (contactsRes.error) {
      console.warn("[mobile-inbox] no se pudieron leer los contactos:", contactsRes.error.message);
    }
    if (queuesRes.error) {
      console.warn("[mobile-inbox] no se pudieron leer las colas:", queuesRes.error.message);
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
      name: string | null;
      provider: string | null;
    }>) {
      channelById.set(c.id, { name: c.name ?? null, provider: c.provider ?? null });
    }

    const nombrePorCola = new Map<string, string>();
    for (const q of (queuesRes.data ?? []) as Array<{ id: string; nombre: string | null }>) {
      if (q.nombre) nombrePorCola.set(q.id, q.nombre);
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
        // `null` = la conversación no está en ninguna cola. La app lo muestra
        // como "Sin cola"; si el campo no viniera, no dibujaría pestañas.
        cola_nombre: r.queue_id ? nombrePorCola.get(r.queue_id) ?? null : null,
      };
    });

    return NextResponse.json(successResponse({ conversations, hay_mas: hayMas }), {
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
