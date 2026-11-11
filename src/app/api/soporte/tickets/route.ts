import { requireSoporteApi } from "@/lib/soporte/soporte-auth";
import { PESTANAS_TICKETS, TICKET_CAMPOS, type TicketFila } from "@/lib/soporte/dominio";
import { errorInesperado, falla, leerCatalogos, ok, sinPermiso } from "@/lib/soporte/servidor";
import { enriquecerTickets } from "@/lib/soporte/tickets-servidor";
import type { ConsultaFiltrable } from "@/lib/soporte/agregados-servidor";

const POR_PAGINA_MAX = 100;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * GET /api/soporte/tickets
 *
 * Filtros: pestana, estados (lista separada por comas; manda sobre pestana),
 * cargados=1 (los que cargó quien consulta),
 * q (búsqueda inteligente: texto o #número), cliente_id, estado, tipo,
 * responsable_id, prioridad, mios=1 (asignados a quien consulta), revision=1
 * (con una revisión de QA sin terminar asignada a quien consulta), pagina,
 * por_pagina.
 *
 * Cuando hay `q`, la coincidencia y el orden por relevancia los resuelve la
 * base (RPC `soporte_tickets_buscar`): sin tildes, sobre asunto/descripción/
 * cliente/proyecto/clasificación/#número, con orden libre de palabras y
 * tolerancia a errores de tipeo. Sin `q`, el listado va por el camino normal.
 *
 * Devuelve además el conteo por estado con el resto de los filtros aplicados:
 * cada pantalla arma sus propias pestañas con eso ("Tickets" y "Mis tickets"
 * no agrupan igual).
 */
type ConsultaOrdenable = { order: (col: string, o: { ascending: boolean }) => ConsultaOrdenable };

function ordenar<T extends ConsultaOrdenable>(q: T, orden: string | null): T {
  if (orden === "numero_asc") return q.order("numero", { ascending: true }) as T;
  if (orden === "numero_desc") return q.order("numero", { ascending: false }) as T;
  return q.order("updated_at", { ascending: false }) as T;
}

export async function GET(request: Request) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);

  try {
    const url = new URL(request.url);
    const p = url.searchParams;

    /**
     * Orden de la lista. El valor de siempre —última actividad— es el predeterminado:
     * sin `orden` en la URL, nada cambia.
     *
     * `numero` es el número visible del ticket (#0362). Sirve para recorrer la lista como
     * un listado correlativo en vez de "lo que se movió recién", que salta de lugar cada
     * vez que alguien comenta algo.
     */
    const pestana = PESTANAS_TICKETS.find((x) => x.id === p.get("pestana")) ?? PESTANAS_TICKETS[0];
    const pagina = Math.max(1, Number(p.get("pagina") ?? "1") || 1);
    const porPagina = Math.min(POR_PAGINA_MAX, Math.max(5, Number(p.get("por_pagina") ?? "20") || 20));
    const texto = (p.get("q") ?? "").trim();
    const estadosParam = (p.get("estados") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    const desde = (pagina - 1) * porPagina;

    // Filtros comunes (sin el texto: con `q` la búsqueda va por el RPC de abajo).
    const aplicarSinMios = (q: ConsultaFiltrable): ConsultaFiltrable => {
      let b = q.eq("empresa_id", auth.empresaId);
      // Los que cargó quien consulta: sirve para seguir lo que uno mismo derivó.
      if (p.get("cargados") === "1") b = b.eq("created_by", auth.usuarioId);
      for (const [param, columna] of [
        ["cliente_id", "cliente_id"],
        ["estado", "estado_codigo"],
        ["tipo", "tipo_codigo"],
        ["prioridad", "prioridad_codigo"],
        ["responsable_id", "responsable_id"],
      ] as const) {
        const v = p.get(param);
        if (v) b = b.eq(columna, v);
      }
      return b;
    };
    const aplicar = (q: ConsultaFiltrable): ConsultaFiltrable =>
      p.get("mios") === "1" ? aplicarSinMios(q).eq("responsable_id", auth.usuarioId) : aplicarSinMios(q);

    // Revisiones de QA sin terminar asignadas a quien consulta (pestaña "Por revisar").
    const soloMios = p.get("mios") === "1";
    const revision = p.get("revision") === "1";
    let idsRevision: string[] = [];
    if (soloMios || revision) {
      const { data: subs } = await auth.sb
        .from("soporte_subtareas")
        .select("ticket_id")
        .eq("empresa_id", auth.empresaId)
        .eq("asignado_id", auth.usuarioId)
        .in("estado", ["pendiente", "en_proceso"]);
      idsRevision = [...new Set(((subs ?? []) as { ticket_id: string }[]).map((x) => x.ticket_id))];
    }

    const armarContadores = (porEstado: Map<string, number>): Record<string, number> => {
      const contadores: Record<string, number> = {};
      for (const t of PESTANAS_TICKETS) {
        contadores[t.id] = t.estados
          ? t.estados.reduce((s, e) => s + (porEstado.get(e) ?? 0), 0)
          : [...porEstado.values()].reduce((s, n) => s + n, 0);
      }
      return contadores;
    };

    // ---------------------------------------------------------------------
    // Búsqueda inteligente: la base devuelve los ids que matchean (todos los
    // estados) ordenados por relevancia; acá paginamos, filtramos por estado
    // y armamos los contadores, igual que el camino normal.
    // ---------------------------------------------------------------------
    if (texto) {
      const { data: matchesRaw, error: rpcErr } = await auth.sb.rpc("soporte_tickets_buscar", {
        p_empresa: auth.empresaId,
        p_q: texto,
        p_cliente: p.get("cliente_id") || null,
        p_tipo: p.get("tipo") || null,
        p_prioridad: p.get("prioridad") || null,
        p_responsable: p.get("responsable_id") || null,
        p_cargados_by: p.get("cargados") === "1" ? auth.usuarioId : null,
        p_mios_by: !revision && soloMios ? auth.usuarioId : null,
        p_ids: revision ? (idsRevision.length ? idsRevision : [NIL_UUID]) : null,
      });
      if (rpcErr) return falla(rpcErr.message);
      const matches = (matchesRaw ?? []) as { id: string; estado_codigo: string; rank: number }[];

      const porEstado = new Map<string, number>();
      for (const m of matches) porEstado.set(m.estado_codigo, (porEstado.get(m.estado_codigo) ?? 0) + 1);

      // La pestaña de revisiones no filtra por estado.
      const estadosFiltro: readonly string[] | null = revision
        ? null
        : estadosParam.length
          ? estadosParam
          : pestana.estados ?? null;
      const filtrados = estadosFiltro
        ? matches.filter((m) => estadosFiltro.includes(m.estado_codigo))
        : matches;
      const total = filtrados.length;
      const pageIds = filtrados.slice(desde, desde + porPagina).map((m) => m.id);

      let filas: TicketFila[] = [];
      if (pageIds.length) {
        const { data: rows, error: rowsErr } = await auth.sb
          .from("soporte_tickets")
          .select(TICKET_CAMPOS)
          .in("id", pageIds);
        if (rowsErr) return falla(rowsErr.message);
        const porId = new Map(((rows ?? []) as TicketFila[]).map((r) => [r.id, r] as const));
        // Respetar el orden de relevancia que devolvió la base.
        filas = pageIds.map((id) => porId.get(id)).filter((x): x is TicketFila => Boolean(x));
      }

      const cat = await leerCatalogos(auth.sb, auth.empresaId);
      const tickets = await enriquecerTickets(auth.sb, auth.empresaId, cat, filas);
      return ok({
        tickets,
        total,
        pagina,
        por_pagina: porPagina,
        contadores: armarContadores(porEstado),
        por_estado: Object.fromEntries(porEstado),
        ...(soloMios || revision ? { revisiones_pendientes: idsRevision.length } : {}),
      });
    }

    // ---------------------------------------------------------------------
    // Camino normal (sin texto): PostgREST con paginación y conteo nativos.
    // ---------------------------------------------------------------------
    let lista = revision
      ? aplicarSinMios(auth.sb.from("soporte_tickets").select(TICKET_CAMPOS, { count: "exact" })).in(
          "id",
          idsRevision.length ? idsRevision : [NIL_UUID]
        )
      : aplicar(auth.sb.from("soporte_tickets").select(TICKET_CAMPOS, { count: "exact" }));
    // La pestaña de revisiones no filtra por estado.
    if (!revision && estadosParam.length) lista = lista.in("estado_codigo", estadosParam);
    else if (!revision && pestana.estados) lista = lista.in("estado_codigo", [...pestana.estados]);
    // Catálogos, página y contadores en paralelo: ninguno espera al otro.
    const [cat, { data, error, count }, { data: todos }] = await Promise.all([
      leerCatalogos(auth.sb, auth.empresaId),
      ordenar(lista, p.get("orden")).range(desde, desde + porPagina - 1),
      // Contadores: una consulta liviana por estado, sumada por pestaña.
      aplicar(auth.sb.from("soporte_tickets").select("estado_codigo")).limit(10_000),
    ]);
    if (error) return falla(error.message);
    const porEstado = new Map<string, number>();
    for (const r of (todos ?? []) as { estado_codigo: string }[]) {
      porEstado.set(r.estado_codigo, (porEstado.get(r.estado_codigo) ?? 0) + 1);
    }

    const tickets = await enriquecerTickets(auth.sb, auth.empresaId, cat, (data ?? []) as TicketFila[]);
    return ok({
      tickets,
      total: count ?? 0,
      pagina,
      por_pagina: porPagina,
      contadores: armarContadores(porEstado),
      por_estado: Object.fromEntries(porEstado),
      ...(soloMios || revision ? { revisiones_pendientes: idsRevision.length } : {}),
    });
  } catch (e) {
    return errorInesperado(e);
  }
}

/**
 * POST /api/soporte/tickets — cerrado.
 *
 * Los tickets nacen de una tipificación del cliente (Gestión de clientes o el
 * botón Soporte de Conversaciones): ver `crearTipificacionConTicket`.
 */
export async function POST(request: Request) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  return falla("Los tickets se cargan desde la tipificación del cliente o desde Conversaciones", 405);
}
