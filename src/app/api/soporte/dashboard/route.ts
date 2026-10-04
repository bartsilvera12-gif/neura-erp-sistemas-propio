import { requireSoporteApi } from "@/lib/soporte/soporte-auth";
import { calcularSla, etiquetaTipo, type TicketFila } from "@/lib/soporte/dominio";
import { clientesDeEmpresa, errorInesperado, leerCatalogos, ok, personasPorId, sinPermiso } from "@/lib/soporte/servidor";
import { ticketsParaAgregar } from "@/lib/soporte/agregados-servidor";
import { TZ_PY } from "@/lib/format/hora-py";

const DIA_MS = 86_400_000;

/** Instante (ms) del 1° del mes en curso, 00:00 hora de Paraguay. */
function inicioMesPy(ahora: number): number {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ_PY, year: "numeric", month: "2-digit" }).formatToParts(new Date(ahora));
  const y = p.find((x) => x.type === "year")?.value ?? "1970";
  const m = p.find((x) => x.type === "month")?.value ?? "01";
  return Date.parse(`${y}-${m}-01T00:00:00-03:00`);
}

/**
 * GET /api/soporte/dashboard?dias=30
 *
 * Vista ejecutiva: KPIs de los tickets creados en el período, con la variación
 * contra el período anterior de igual largo, y las dos distribuciones del
 * tablero. `dias=0` = todo el historial (sin comparación).
 */
export async function GET(request: Request) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  if (!auth.veDashboard) return sinPermiso({ ok: false, status: 403, message: "El Dashboard de Soporte no está habilitado para tu usuario" });
  try {
    const periodo = new URL(request.url).searchParams.get("dias") ?? "30";
    const cat = await leerCatalogos(auth.sb, auth.empresaId);
    const todos = await ticketsParaAgregar(auth.sb, auth.empresaId);

    const ahora = Date.now();
    const ahoraIso = new Date(ahora).toISOString();
    // "mes" = mes calendario en curso (sin comparación, es parcial). El resto son
    // ventanas móviles de N días (con comparación contra el período anterior).
    let inicio: number | null;
    let inicioPrevio: number | null;
    let dias = 0;
    if (periodo === "mes") {
      inicio = inicioMesPy(ahora);
      inicioPrevio = null;
    } else {
      dias = Math.max(0, Math.min(365, Number(periodo) || 0));
      inicio = dias ? ahora - dias * DIA_MS : null;
      inicioPrevio = dias ? ahora - 2 * dias * DIA_MS : null;
    }

    const enRango = (t: TicketFila, desde: number | null, hasta: number) => {
      const c = Date.parse(t.created_at);
      return (desde == null || c >= desde) && c < hasta;
    };
    const actuales = todos.filter((t) => enRango(t, inicio, ahora + 1));
    const previos = inicioPrevio != null && inicio != null ? todos.filter((t) => enRango(t, inicioPrevio, inicio)) : [];

    const kpis = (lista: TicketFila[]) => {
      const cuenta = (...codigos: string[]) => lista.filter((t) => codigos.includes(t.estado_codigo)).length;
      return {
        total: lista.length,
        pendientes: cuenta("pendiente"),
        en_proceso: cuenta("en_proceso", "reabierto"),
        falta_informacion: cuenta("falta_informacion"),
        en_revision: cuenta("listo_revision"),
        resueltos: cuenta("resuelto"),
        cerrados: cuenta("cerrado", "cancelado"),
        sla_vencidos: lista.filter((t) => calcularSla(t, ahoraIso).estado === "vencido").length,
      };
    };
    const kActual = kpis(actuales);
    const kPrevio = inicioPrevio != null && inicio != null ? kpis(previos) : null;
    const variacion: Record<string, number | null> = {};
    for (const k of Object.keys(kActual) as (keyof typeof kActual)[]) {
      const antes = kPrevio?.[k];
      variacion[k] = antes == null || antes === 0 ? null : Math.round(((kActual[k] - antes) / antes) * 100);
    }

    const porEstado = cat.estados
      .filter((e) => e.activo)
      .map((e) => ({
        codigo: e.codigo,
        nombre: e.nombre,
        color: e.color,
        cantidad: actuales.filter((t) => t.estado_codigo === e.codigo).length,
      }));

    const tipos = new Map<string, number>();
    for (const t of actuales) {
      const et = etiquetaTipo(cat, t.tipo_codigo, t.clasificacion_codigo);
      tipos.set(et, (tipos.get(et) ?? 0) + 1);
    }
    const porTipo = [...tipos.entries()].map(([nombre, cantidad]) => ({ nombre, cantidad })).sort((a, b) => b.cantidad - a.cantidad);

    // Tickets por TIPO DE SISTEMA: cada ticket es sobre un proyecto concreto, y
    // el proyecto tiene UN tipo (Web / SaaS-ERP / Mixto). Así se atribuye por
    // ticket —un cliente con 2 suscripciones reparte bien sus tickets—, sin
    // depender del "tipo de cliente" (ambiguo). Drift-safe: si el tenant no
    // tiene proyectos/tipos, queda vacío.
    let porSistema: { nombre: string; cantidad: number }[] = [];
    // Dos cortes SEPARADOS: Top clientes (por tickets) y Tickets por programador
    // (el responsable_tecnico del proyecto al que pertenece cada ticket).
    type ItemTicketOut = { id: string; numero: number | null; proyecto: string; tipo: string };
    let topClientes: { cliente: string; tickets: number; items: ItemTicketOut[] }[] = [];
    let porProgramador: { programador: string; tickets: number; items: ItemTicketOut[] }[] = [];
    try {
      const [tiposRes, proysRes] = await Promise.all([
        auth.sb.from("proyecto_tipos").select("id, nombre").eq("empresa_id", auth.empresaId),
        auth.sb.from("proyectos").select("id, tipo_id, responsable_tecnico_id, titulo").eq("empresa_id", auth.empresaId).limit(5000),
      ]);
      const nombreTipo = new Map<string, string>();
      for (const tp of (tiposRes.data ?? []) as { id: string; nombre: string }[]) nombreTipo.set(tp.id, tp.nombre);
      const tipoDeProyecto = new Map<string, string | null>();
      const tecnicoDeProyecto = new Map<string, string | null>();
      const tituloDeProyecto = new Map<string, string>();
      for (const p of (proysRes.data ?? []) as { id: string; tipo_id: string | null; responsable_tecnico_id: string | null; titulo: string | null }[]) {
        tipoDeProyecto.set(p.id, p.tipo_id);
        tecnicoDeProyecto.set(p.id, p.responsable_tecnico_id);
        tituloDeProyecto.set(p.id, (p.titulo ?? "").trim() || "—");
      }

      // --- por tipo de sistema ---
      if (nombreTipo.size > 0) {
        const sistemas = new Map<string, number>();
        for (const t of actuales) {
          const tipoId = t.proyecto_id ? tipoDeProyecto.get(t.proyecto_id) ?? null : null;
          const nombre = (tipoId && nombreTipo.get(tipoId)) || "Sin sistema asociado";
          sistemas.set(nombre, (sistemas.get(nombre) ?? 0) + 1);
        }
        porSistema = [...sistemas.entries()].map(([nombre, cantidad]) => ({ nombre, cantidad })).sort((a, b) => b.cantidad - a.cantidad);
      }

      // Cada ticket: su nº, tipo y id (para listar al desplegar y poder abrirlo).
      type ItemTicket = { id: string; numero: number | null; proyecto: string; tipo: string };
      const porDesc = (a: ItemTicket, b: ItemTicket) => (b.numero ?? 0) - (a.numero ?? 0);

      // --- (1) Top clientes por tickets ---
      const porCliente = new Map<string, ItemTicket[]>();
      // --- (2) Tickets por programador (del proyecto del ticket) ---
      const porTec = new Map<string | null, ItemTicket[]>();
      for (const t of actuales) {
        const item: ItemTicket = {
          id: t.id,
          numero: t.numero ?? null,
          proyecto: t.proyecto_id ? tituloDeProyecto.get(t.proyecto_id) ?? "—" : "—",
          tipo: etiquetaTipo(cat, t.tipo_codigo, t.clasificacion_codigo),
        };
        if (t.cliente_id) {
          const arr = porCliente.get(t.cliente_id) ?? [];
          arr.push(item);
          porCliente.set(t.cliente_id, arr);
        }
        const tecId = t.proyecto_id ? tecnicoDeProyecto.get(t.proyecto_id) ?? null : null;
        const arr2 = porTec.get(tecId) ?? [];
        arr2.push(item);
        porTec.set(tecId, arr2);
      }

      const top = [...porCliente.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 10);
      const clientes = await clientesDeEmpresa(auth.sb, auth.empresaId);
      const nombreCliente = new Map(clientes.map((c) => [c.id, c.nombre]));
      topClientes = top.map(([cid, items]) => ({ cliente: nombreCliente.get(cid) ?? "Cliente", tickets: items.length, items: [...items].sort(porDesc) }));

      const personas = await personasPorId([...porTec.keys()].filter((x): x is string => !!x));
      porProgramador = [...porTec.entries()]
        .map(([tecId, items]) => ({ programador: tecId ? personas.get(tecId)?.nombre ?? "—" : "Sin programador", tickets: items.length, items: [...items].sort(porDesc) }))
        .sort((a, b) => b.tickets - a.tickets);
    } catch {
      porSistema = [];
      topClientes = [];
      porProgramador = [];
    }

    return ok({ dias, kpis: kActual, variacion, por_estado: porEstado, por_tipo: porTipo, por_sistema: porSistema, top_clientes: topClientes, por_programador: porProgramador });
  } catch (e) {
    return errorInesperado(e);
  }
}
