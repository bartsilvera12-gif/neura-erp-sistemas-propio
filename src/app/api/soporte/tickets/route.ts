import { requireSoporteApi } from "@/lib/soporte/soporte-auth";
import {
  PESTANAS_TICKETS,
  TICKET_CAMPOS,
  requiereResponsable,
  slaDe,
  type TicketFila,
} from "@/lib/soporte/dominio";
import {
  errorInesperado,
  falla,
  leerCatalogos,
  ok,
  personasDeEmpresa,
  registrarHistorial,
  sinPermiso,
  type EventoHistorial,
} from "@/lib/soporte/servidor";
import { enriquecerTickets } from "@/lib/soporte/tickets-servidor";
import type { ConsultaFiltrable } from "@/lib/soporte/agregados-servidor";

const UUID = /^[0-9a-f-]{36}$/i;
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
    const cat = await leerCatalogos(auth.sb, auth.empresaId);

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
    const { data, error, count } = await lista
      .order("updated_at", { ascending: false })
      .range(desde, desde + porPagina - 1);
    if (error) return falla(error.message);

    // Contadores: una consulta liviana por estado, sumada por pestaña.
    const { data: todos } = await aplicar(auth.sb.from("soporte_tickets").select("estado_codigo")).limit(10_000);
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

function texto(v: unknown, max = 20_000): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

/**
 * POST /api/soporte/tickets — crea un ticket.
 *
 * El SLA se congela acá, desde la clasificación. Si el ticket entra con
 * responsable queda "Clasificado / Asignado"; sin responsable, "Registrado",
 * que es el único estado activo que puede quedar sin nadie a cargo.
 */
export async function POST(request: Request) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return falla("Datos inválidos");
    const cat = await leerCatalogos(auth.sb, auth.empresaId);

    const clienteId = typeof body.cliente_id === "string" ? body.cliente_id : "";
    if (!UUID.test(clienteId)) return falla("Elegí un cliente");
    const { data: cliente } = await auth.sb
      .from("clientes")
      .select("id")
      .eq("empresa_id", auth.empresaId)
      .eq("id", clienteId)
      .maybeSingle();
    if (!cliente) return falla("El cliente no existe");

    const tipo = cat.tipos.find((t) => t.activo && t.codigo === body.tipo_codigo);
    if (!tipo) return falla("Elegí el tipo de solicitud");

    const clasificacionesDelTipo = cat.clasificaciones.filter((c) => c.activo && c.tipo_codigo === tipo.codigo);
    let clasificacion: string | null = null;
    if (clasificacionesDelTipo.length > 0) {
      const c = clasificacionesDelTipo.find((x) => x.codigo === body.clasificacion_codigo);
      if (!c) return falla("Elegí la clasificación");
      clasificacion = c.codigo;
    }

    const prioridad = cat.prioridades.find((x) => x.activo && x.codigo === body.prioridad_codigo);
    if (!prioridad) return falla("Elegí la prioridad");

    const asunto = texto(body.asunto, 200);
    if (!asunto) return falla("El asunto es obligatorio");
    const descripcion = texto(body.descripcion);
    if (!descripcion) return falla("La descripción es obligatoria");

    let proyectoId: string | null = null;
    if (typeof body.proyecto_id === "string" && body.proyecto_id) {
      if (!UUID.test(body.proyecto_id)) return falla("Proyecto inválido");
      const { data: pr } = await auth.sb
        .from("proyectos")
        .select("id")
        .eq("empresa_id", auth.empresaId)
        .eq("id", body.proyecto_id)
        .eq("cliente_id", clienteId)
        .maybeSingle();
      if (!pr) return falla("El proyecto no pertenece a ese cliente");
      proyectoId = body.proyecto_id;
    }

    let responsableId: string | null = null;
    if (typeof body.responsable_id === "string" && body.responsable_id) {
      const equipo = await personasDeEmpresa(auth.empresaId);
      if (!equipo.some((u) => u.id === body.responsable_id)) return falla("Responsable inválido");
      responsableId = body.responsable_id;
    }

    let fechaObjetivo: string | null = null;
    if (typeof body.fecha_objetivo === "string" && body.fecha_objetivo) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.fecha_objetivo)) return falla("Fecha objetivo inválida");
      fechaObjetivo = body.fecha_objetivo;
    }

    const inicial = cat.estados.find((e) => e.es_inicial) ?? cat.estados[0];
    const asignado = cat.estados.find((e) => e.codigo === "clasificado");
    const estado = responsableId && asignado ? asignado : inicial;
    if (!estado) return falla("Soporte no tiene estados configurados", 500);
    if (requiereResponsable(estado) && !responsableId) return falla("Elegí un responsable");

    const slaHoras = slaDe(cat, tipo.codigo, clasificacion);

    const { data: creado, error } = await auth.sb
      .from("soporte_tickets")
      .insert({
        empresa_id: auth.empresaId,
        numero: 0,
        asunto,
        descripcion,
        resultado_esperado: texto(body.resultado_esperado),
        impacto_operativo: texto(body.impacto_operativo),
        pasos_reproducir: texto(body.pasos_reproducir),
        criterios_aceptacion: texto(body.criterios_aceptacion),
        cliente_id: clienteId,
        proyecto_id: proyectoId,
        modulo: texto(body.modulo, 120),
        version: texto(body.version, 60),
        entorno: texto(body.entorno, 60),
        navegador: texto(body.navegador, 120),
        tipo_codigo: tipo.codigo,
        clasificacion_codigo: clasificacion,
        prioridad_codigo: prioridad.codigo,
        estado_codigo: estado.codigo,
        responsable_id: responsableId,
        proxima_accion: texto(body.proxima_accion, 500),
        sla_horas: slaHoras,
        fecha_objetivo: fechaObjetivo,
        created_by: auth.usuarioId,
        updated_by: auth.usuarioId,
      })
      .select("id, numero")
      .single();
    if (error || !creado) return falla(error?.message ?? "No se pudo crear el ticket");

    const eventos: EventoHistorial[] = [
      {
        tipo_evento: "creacion",
        valor_nuevo: estado.codigo,
        metadata: { numero: creado.numero, tipo: tipo.codigo, clasificacion, prioridad: prioridad.codigo, sla_horas: slaHoras },
      },
    ];
    if (responsableId) {
      eventos.push({ tipo_evento: "cambio_responsable", valor_anterior: null, valor_nuevo: responsableId });
    }
    await registrarHistorial(auth.sb, {
      empresaId: auth.empresaId,
      ticketId: creado.id as string,
      usuarioId: auth.usuarioId,
      eventos,
    });

    return ok({ id: creado.id, numero: creado.numero });
  } catch (e) {
    return errorInesperado(e);
  }
}
