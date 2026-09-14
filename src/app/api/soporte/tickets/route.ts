import { requireSoporteApi } from "@/lib/soporte/soporte-auth";
import { PESTANAS_TICKETS, TICKET_CAMPOS, type TicketFila } from "@/lib/soporte/dominio";
import { prepararTicket, registrarAltaTicket } from "@/lib/soporte/crear-ticket";
import { errorInesperado, falla, leerCatalogos, ok, sinPermiso } from "@/lib/soporte/servidor";
import { enriquecerTickets } from "@/lib/soporte/tickets-servidor";
import type { ConsultaFiltrable } from "@/lib/soporte/agregados-servidor";

const POR_PAGINA_MAX = 100;

/**
 * GET /api/soporte/tickets
 *
 * Filtros: pestana, estados (lista separada por comas; manda sobre pestana),
 * q (texto o #número), cliente_id, estado, tipo, responsable_id, prioridad,
 * mios=1 (asignados a quien consulta), pagina, por_pagina.
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
    const aplicar = (q: ConsultaFiltrable): ConsultaFiltrable => {
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
      if (p.get("mios") === "1") b = b.eq("responsable_id", auth.usuarioId);
      return b;
    };

    let lista = aplicar(auth.sb.from("soporte_tickets").select(TICKET_CAMPOS, { count: "exact" }));
    const estadosParam = (p.get("estados") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    if (estadosParam.length) lista = lista.in("estado_codigo", estadosParam);
    else if (pestana.estados) lista = lista.in("estado_codigo", [...pestana.estados]);
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
    });
  } catch (e) {
    return errorInesperado(e);
  }
}

/**
 * POST /api/soporte/tickets — crea un ticket.
 *
 * El SLA se congela acá, desde la clasificación. Si el ticket entra con
 * responsable queda "Clasificado / Asignado"; sin responsable, "Registrado",
 * que es el único estado activo que puede quedar sin nadie a cargo. La regla
 * vive en `prepararTicket`, la misma que usa la tipificación de cliente.
 */
export async function POST(request: Request) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return falla("Datos inválidos");

    const prep = await prepararTicket(auth, body);
    if (!prep.ok) return falla(prep.mensaje, prep.status);

    const { data: creado, error } = await auth.sb
      .from("soporte_tickets")
      .insert({ ...prep.ticket.fila, origen: "manual" })
      .select("id, numero")
      .single();
    if (error || !creado) return falla(error?.message ?? "No se pudo crear el ticket");

    await registrarAltaTicket(auth, { ticketId: creado.id as string, numero: creado.numero as number, ticket: prep.ticket });

    return ok({ id: creado.id, numero: creado.numero });
  } catch (e) {
    return errorInesperado(e);
  }
}
