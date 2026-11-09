import { requireSoporteApi } from "@/lib/soporte/soporte-auth";
import {
  clientesPorId,
  errorInesperado,
  falla,
  leerCatalogos,
  ok,
  personasPorId,
  sinPermiso,
} from "@/lib/soporte/servidor";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Eventos de historial cuyo `valor_nuevo` es un estado al que se "entra" (no reaperturas). */
const EVENTOS_ESTADO = ["cambio_estado", "cierre", "cancelacion", "confirmacion_qa", "resuelto_guardia"];

/** Fecha/hora local Paraguay (UTC-3 fijo) a partir de un ISO en UTC. */
function aLocalPy(iso: string): Date {
  return new Date(Date.parse(iso) - 3 * 3_600_000);
}
function diaPy(iso: string): string {
  return aLocalPy(iso).toISOString().slice(0, 10); // YYYY-MM-DD
}
function horaPy(iso: string): string {
  return aLocalPy(iso).toISOString().slice(11, 16); // HH:MM
}
/** "01/11" desde "2026-11-01". */
function etiquetaDia(ymd: string): string {
  return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
}

type FilaHistorial = { ticket_id: string; valor_nuevo: string | null; created_at: string };

/**
 * GET /api/soporte/reportes/mis-cierres?desde&hasta
 *
 * Tickets que CERRÓ el usuario actual en el rango: cada vez que movió un ticket
 * a un estado "cerrado" (Resuelto / Cerrado / Cancelado) queda en el historial
 * con su `usuario_id`. Se toma el ÚLTIMO cierre por ticket dentro del rango, se
 * agrupa por día (hora de Paraguay) y se calcula el porcentaje de resueltos.
 *
 * "Cerré" = yo hice la transición al estado cerrado, sin importar quién era el
 * responsable. Así el reporte es "lo que yo cerré", no "lo que me asignaron".
 */
export async function GET(request: Request) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  try {
    const p = new URL(request.url).searchParams;
    const hoy = new Date().toISOString().slice(0, 10);
    const hace30 = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const desde = FECHA.test(p.get("desde") ?? "") ? (p.get("desde") as string) : hace30;
    const hasta = FECHA.test(p.get("hasta") ?? "") ? (p.get("hasta") as string) : hoy;
    if (desde > hasta) return falla("La fecha desde no puede ser posterior a hasta");

    const cat = await leerCatalogos(auth.sb, auth.empresaId);
    const estadosCerrados = cat.estados.filter((e) => e.tipo === "cerrado");
    const codigosCerrados = estadosCerrados.map((e) => e.codigo);
    const estadoPorCodigo = new Map(cat.estados.map((e) => [e.codigo, e]));
    // "Resuelto satisfactoriamente" = resuelto o cerrado. Cancelado NO cuenta como resuelto.
    const esResuelto = (codigo: string) => codigo === "resuelto" || codigo === "cerrado";

    if (codigosCerrados.length === 0) return falla("La empresa no tiene estados de cierre configurados");

    // Cierres que hizo este usuario en el rango (hora de Paraguay, UTC-3).
    const { data, error } = await auth.sb
      .from("soporte_ticket_historial")
      .select("ticket_id, valor_nuevo, created_at")
      .eq("empresa_id", auth.empresaId)
      .eq("usuario_id", auth.usuarioId)
      .in("tipo_evento", EVENTOS_ESTADO)
      .in("valor_nuevo", codigosCerrados)
      .gte("created_at", `${desde}T00:00:00-03:00`)
      .lte("created_at", `${hasta}T23:59:59.999-03:00`)
      .order("created_at", { ascending: true })
      .limit(5000);
    if (error) return falla(error.message);
    const filas = (data ?? []) as FilaHistorial[];

    // Último cierre por ticket dentro del rango: refleja cómo quedó al cerrarlo.
    const ultimoPorTicket = new Map<string, FilaHistorial>();
    for (const f of filas) {
      if (!f.valor_nuevo) continue;
      ultimoPorTicket.set(f.ticket_id, f); // ordenado ascendente → el último gana
    }
    const cierres = [...ultimoPorTicket.values()];

    const ids = cierres.map((c) => c.ticket_id);
    // Datos de los tickets cerrados.
    type Tk = { id: string; numero: number | null; asunto: string | null; cliente_id: string | null };
    const ticketPorId = new Map<string, Tk>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data: tks } = await auth.sb
        .from("soporte_tickets")
        .select("id, numero, asunto, cliente_id")
        .eq("empresa_id", auth.empresaId)
        .in("id", ids.slice(i, i + 200));
      for (const t of (tks ?? []) as Tk[]) ticketPorId.set(t.id, t);
    }

    const clientes = await clientesPorId(auth.sb, auth.empresaId, [...ticketPorId.values()].map((t) => t.cliente_id));
    const yo = (await personasPorId([auth.usuarioId])).get(auth.usuarioId) ?? null;

    // Agregados.
    type Item = {
      id: string;
      numero: number | null;
      asunto: string | null;
      cliente: string | null;
      estado_codigo: string;
      estado_nombre: string;
      color: string;
      resuelto: boolean;
      hora: string;
      iso: string;
    };
    const items: Item[] = [];
    const conteoEstado = new Map<string, number>();
    for (const c of cierres) {
      const tk = ticketPorId.get(c.ticket_id);
      if (!tk) continue; // ticket borrado
      const codigo = c.valor_nuevo as string;
      const est = estadoPorCodigo.get(codigo);
      conteoEstado.set(codigo, (conteoEstado.get(codigo) ?? 0) + 1);
      items.push({
        id: tk.id,
        numero: tk.numero,
        asunto: tk.asunto,
        cliente: tk.cliente_id ? (clientes.get(tk.cliente_id) ?? "Cliente") : null,
        estado_codigo: codigo,
        estado_nombre: est?.nombre ?? codigo,
        color: est?.color ?? "#64748b",
        resuelto: esResuelto(codigo),
        hora: horaPy(c.created_at),
        iso: c.created_at,
      });
    }

    const total = items.length;
    const resueltos = items.filter((i) => i.resuelto).length;
    const cancelados = total - resueltos;

    // Por estado (para el gráfico de torta), respetando el orden del catálogo.
    const porEstado = estadosCerrados
      .map((e) => ({ clave: e.codigo, nombre: e.nombre, cantidad: conteoEstado.get(e.codigo) ?? 0, color: e.color }))
      .filter((e) => e.cantidad > 0);

    // Por día (hora de Paraguay), ascendente.
    const diasMap = new Map<string, Item[]>();
    for (const it of items) {
      const d = diaPy(it.iso);
      (diasMap.get(d) ?? diasMap.set(d, []).get(d)!).push(it);
    }
    const porDia = [...diasMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([fecha, lista]) => {
        lista.sort((a, b) => a.iso.localeCompare(b.iso));
        const res = lista.filter((x) => x.resuelto).length;
        return {
          fecha,
          etiqueta: etiquetaDia(fecha),
          total: lista.length,
          resueltos: res,
          cancelados: lista.length - res,
          porcentaje_resuelto: lista.length ? Math.round((res / lista.length) * 100) : 0,
          items: lista.map((x) => ({
            id: x.id,
            numero: x.numero,
            asunto: x.asunto,
            cliente: x.cliente,
            estado_codigo: x.estado_codigo,
            estado_nombre: x.estado_nombre,
            color: x.color,
            resuelto: x.resuelto,
            hora: x.hora,
          })),
        };
      });

    const diasConCierres = porDia.length;

    return ok({
      desde,
      hasta,
      usuario: { id: auth.usuarioId, nombre: yo?.nombre ?? "Yo" },
      total,
      resueltos,
      cancelados,
      porcentaje_resuelto: total ? Math.round((resueltos / total) * 100) : null,
      dias_con_cierres: diasConCierres,
      promedio_por_dia: diasConCierres ? Math.round((total / diasConCierres) * 10) / 10 : 0,
      por_estado: porEstado,
      por_dia: porDia,
    });
  } catch (e) {
    return errorInesperado(e);
  }
}
