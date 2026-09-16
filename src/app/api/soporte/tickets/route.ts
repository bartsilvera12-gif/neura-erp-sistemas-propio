import { requireSoporteApi } from "@/lib/soporte/soporte-auth";
import { PESTANAS_TICKETS, TICKET_CAMPOS, type TicketFila } from "@/lib/soporte/dominio";
import { errorInesperado, falla, leerCatalogos, ok, sinPermiso } from "@/lib/soporte/servidor";
import { enriquecerTickets } from "@/lib/soporte/tickets-servidor";
import type { ConsultaFiltrable } from "@/lib/soporte/agregados-servidor";

const POR_PAGINA_MAX = 100;

/**
 * GET /api/soporte/tickets
 *
 * Filtros: pestana, estados (lista separada por comas; manda sobre pestana),
 * q (texto o #número), cliente_id, estado, tipo, responsable_id, prioridad,
 * mios=1 (asignados a quien consulta), revision=1 (con una revisión de QA sin
 * terminar asignada a quien consulta), pagina, por_pagina.
 *
 * Devuelve además el conteo por estado con el resto de los filtros aplicados:
 * cada pantalla arma sus propias pestañas con eso ("Tickets" y "Mis tickets"
 * no agrupan igual).
 */
export async function GET(request: Request) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);

  try {
    const url = new URL(request.url);
    const p = url.searchParams;

    const pestana = PESTANAS_TICKETS.find((x) => x.id === p.get("pestana")) ?? PESTANAS_TICKETS[0];
    const pagina = Math.max(1, Number(p.get("pagina") ?? "1") || 1);
    const porPagina = Math.min(POR_PAGINA_MAX, Math.max(5, Number(p.get("por_pagina") ?? "20") || 20));

    // Filtros comunes a la lista y a los contadores.
    const aplicarSinMios = (q: ConsultaFiltrable): ConsultaFiltrable => {
      let b = q.eq("empresa_id", auth.empresaId);
      const texto = (p.get("q") ?? "").trim();
      if (texto) {
        const numero = texto.replace(/^#/, "");
        if (/^\d+$/.test(numero)) b = b.eq("numero", Number(numero));
        else b = b.ilike("asunto", `%${texto.replace(/[%_]/g, "")}%`);
      }
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

    let lista = revision
      ? aplicarSinMios(auth.sb.from("soporte_tickets").select(TICKET_CAMPOS, { count: "exact" })).in(
          "id",
          idsRevision.length ? idsRevision : ["00000000-0000-0000-0000-000000000000"]
        )
      : aplicar(auth.sb.from("soporte_tickets").select(TICKET_CAMPOS, { count: "exact" }));
    const estadosParam = (p.get("estados") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    // La pestaña de revisiones no filtra por estado.
    if (!revision && estadosParam.length) lista = lista.in("estado_codigo", estadosParam);
    else if (!revision && pestana.estados) lista = lista.in("estado_codigo", [...pestana.estados]);
    const desde = (pagina - 1) * porPagina;
    // Catálogos, página y contadores en paralelo: ninguno espera al otro.
    const [cat, { data, error, count }, { data: todos }] = await Promise.all([
      leerCatalogos(auth.sb, auth.empresaId),
      lista.order("updated_at", { ascending: false }).range(desde, desde + porPagina - 1),
      // Contadores: una consulta liviana por estado, sumada por pestaña.
      aplicar(auth.sb.from("soporte_tickets").select("estado_codigo")).limit(10_000),
    ]);
    if (error) return falla(error.message);
    const porEstado = new Map<string, number>();
    for (const r of (todos ?? []) as { estado_codigo: string }[]) {
      porEstado.set(r.estado_codigo, (porEstado.get(r.estado_codigo) ?? 0) + 1);
    }
    const contadores: Record<string, number> = {};
    for (const t of PESTANAS_TICKETS) {
      contadores[t.id] = t.estados
        ? t.estados.reduce((s, e) => s + (porEstado.get(e) ?? 0), 0)
        : [...porEstado.values()].reduce((s, n) => s + n, 0);
    }

    const tickets = await enriquecerTickets(auth.sb, auth.empresaId, cat, (data ?? []) as TicketFila[]);
    return ok({
      tickets,
      total: count ?? 0,
      pagina,
      por_pagina: porPagina,
      contadores,
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
