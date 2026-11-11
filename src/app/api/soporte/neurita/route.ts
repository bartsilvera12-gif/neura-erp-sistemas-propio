import { requireSoporteApi } from "@/lib/soporte/soporte-auth";
import { errorInesperado, falla, ok, personasPorId, sinPermiso, clientesDeEmpresa } from "@/lib/soporte/servidor";
import { ticketsParaAgregar } from "@/lib/soporte/agregados-servidor";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import type { TicketFila } from "@/lib/soporte/dominio";
import { TZ_PY } from "@/lib/format/hora-py";

/**
 * El usuario del agente en sistema propio. Se busca por email y, si no está,
 * por nombre: la cuenta se renombró de "Soporte Ia" a "Neurita" y el nombre
 * puede volver a cambiar, el email no.
 */
const EMAIL_AGENTE = process.env.SOPORTE_AGENTE_EMAIL?.trim() || "soporte-ia@neura.com.py";
const NOMBRE_AGENTE = "neurit";

/** Espejo de AGENTE_TOPE_MES_USD del agente: al llegar, deja de tomar tickets nuevos. */
const TOPE_MES_USD = Number(process.env.SOPORTE_AGENTE_TOPE_MES_USD || 1000);

function hoyPy(): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ_PY, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

const red = (n: number) => Math.round(n * 100) / 100;

/** Mediana, no promedio: un ticket de seis horas no tiene que mover el número. */
function mediana(xs: number[]): number | null {
  if (!xs.length) return null;
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

type FilaGasto = { fecha: string; ticket_numero: number | null; usd: number | string | null; detalle: string | null };
type FilaHist = { ticket_id: string; usuario_id: string | null; valor_nuevo: string | null; created_at: string };

/** Lee una tabla por lotes: el historial de un año no entra en una sola consulta. */
async function porLotes<T>(consulta: (desde: number, hasta: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const todos: T[] = [];
  for (let desde = 0; desde < 100_000; desde += 1000) {
    const { data, error } = await consulta(desde, desde + 999);
    if (error) throw new Error(error.message);
    const lote = (data ?? []) as T[];
    todos.push(...lote);
    if (lote.length < 1000) break;
  }
  return todos;
}

/**
 * GET /api/soporte/neurita — tablero del agente de IA.
 *
 * Todo sale de datos que ya existen: los avisos de gasto, los tickets donde el
 * agente es responsable y el historial de estados. El agente no informa nada
 * especial para esto.
 *
 * Las vueltas de un ticket se cuentan solas: el agente avisa un gasto por cada
 * vuelta del modelo, así que la cantidad de avisos de un ticket ES su cantidad
 * de vueltas.
 */
export async function GET(request: Request) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  try {
    const catalog = createServiceRoleClient();
    const { data: usuarios, error: eUsr } = await catalog.from("usuarios").select("id, nombre, email").eq("empresa_id", auth.empresaId);
    if (eUsr) return falla(eUsr.message);
    const lista = (usuarios ?? []) as { id: string; nombre: string | null; email: string | null }[];
    const agente =
      lista.find((u) => (u.email ?? "").toLowerCase() === EMAIL_AGENTE) ??
      lista.find((u) => (u.nombre ?? "").toLowerCase().includes(NOMBRE_AGENTE)) ??
      null;

    const hoy = hoyPy();
    const mes = hoy.slice(0, 7);

    const gastos = await porLotes<FilaGasto>((d, h) =>
      auth.sb.from("soporte_agente_gastos").select("fecha, ticket_numero, usd, detalle").eq("empresa_id", auth.empresaId).order("fecha").range(d, h)
    );

    let usdHoy = 0;
    let usdMes = 0;
    let usdTotal = 0;
    const usdPorTicket = new Map<number, number>();
    const vueltasPorTicket = new Map<number, number>();
    let vueltasHoy = 0;
    for (const g of gastos) {
      const usd = Number(g.usd ?? 0);
      if (!Number.isFinite(usd)) continue;
      usdTotal += usd;
      if (g.fecha === hoy) {
        usdHoy += usd;
        vueltasHoy++;
      }
      if (typeof g.fecha === "string" && g.fecha.startsWith(mes)) usdMes += usd;
      if (g.ticket_numero != null) {
        usdPorTicket.set(g.ticket_numero, (usdPorTicket.get(g.ticket_numero) ?? 0) + usd);
        vueltasPorTicket.set(g.ticket_numero, (vueltasPorTicket.get(g.ticket_numero) ?? 0) + 1);
      }
    }

    // Tickets y su historial de estados. Con el historial se sabe QUIÉN resolvió
    // cada uno y cuándo, que es lo que `responsable_id` solo no dice.
    const tickets = await ticketsParaAgregar(auth.sb, auth.empresaId);
    const historial = await porLotes<FilaHist>((d, h) =>
      auth.sb
        .from("soporte_ticket_historial")
        .select("ticket_id, usuario_id, valor_nuevo, created_at")
        .eq("empresa_id", auth.empresaId)
        .in("valor_nuevo", ["en_proceso", "resuelto", "reabierto"])
        .order("created_at")
        .range(d, h)
    );

    // Por persona: qué tickets resolvió, cuánto tardó, y cuántos le volvieron.
    const tomaPor = new Map<string, number>(); // ticket+usuario → primer "en proceso"
    const resueltosPor = new Map<string, { ticket: string; minutos: number | null; cuando: number }[]>();
    const reaperturas = new Map<string, number[]>(); // ticket → momentos en que se reabrió
    for (const h of historial) {
      const cuando = Date.parse(h.created_at);
      if (!Number.isFinite(cuando)) continue;
      if (h.valor_nuevo === "reabierto") {
        const xs = reaperturas.get(h.ticket_id) ?? [];
        xs.push(cuando);
        reaperturas.set(h.ticket_id, xs);
        continue;
      }
      if (!h.usuario_id) continue;
      const clave = `${h.ticket_id}|${h.usuario_id}`;
      if (h.valor_nuevo === "en_proceso") {
        if (!tomaPor.has(clave)) tomaPor.set(clave, cuando);
        continue;
      }
      // resuelto
      const inicio = tomaPor.get(clave);
      const xs = resueltosPor.get(h.usuario_id) ?? [];
      xs.push({ ticket: h.ticket_id, minutos: inicio != null ? (cuando - inicio) / 60_000 : null, cuando });
      resueltosPor.set(h.usuario_id, xs);
    }

    const resumenDe = (usuarioId: string) => {
      const xs = resueltosPor.get(usuarioId) ?? [];
      // Un ticket resuelto dos veces (volvió y se arregló de nuevo) cuenta una.
      const unicos = new Set(xs.map((x) => x.ticket));
      // "Volvió" = lo dio por resuelto y después alguien lo reabrió. Es la única
      // medida honesta de si el arreglo servía.
      const volvieron = [...unicos].filter((t) => {
        const primerCierre = Math.min(...xs.filter((x) => x.ticket === t).map((x) => x.cuando));
        return (reaperturas.get(t) ?? []).some((r) => r > primerCierre);
      });
      return {
        resueltos: unicos.size,
        medianaMinutos: mediana(xs.map((x) => x.minutos).filter((m): m is number => m != null)),
        volvieron: volvieron.length,
      };
    };

    const mio = agente ? resumenDe(agente.id) : { resueltos: 0, medianaMinutos: null, volvieron: 0 };
    const abiertos = agente
      ? tickets.filter((t) => t.responsable_id === agente.id && !["cerrado", "cancelado", "resuelto"].includes(t.estado_codigo)).length
      : 0;

    // Comparativo: el agente y las personas que resolvieron algo.
    const comparativo: { id: string; nombre: string; resueltos: number; medianaMinutos: number | null; esAgente: boolean }[] = [];
    const personas = await personasPorId([...resueltosPor.keys()]);
    for (const id of resueltosPor.keys()) {
      const r = resumenDe(id);
      if (!r.resueltos) continue;
      comparativo.push({
        id,
        nombre: personas.get(id)?.nombre ?? "—",
        resueltos: r.resueltos,
        medianaMinutos: r.medianaMinutos,
        esAgente: id === agente?.id,
      });
    }
    comparativo.sort((a, b) => b.resueltos - a.resueltos);

    // Lo que trabajó hoy, tomado de los avisos de gasto (un aviso = una vuelta).
    const clientes = new Map((await clientesDeEmpresa(auth.sb, auth.empresaId)).map((c) => [c.id, c.nombre] as const));
    const numerosHoy = [...new Set(gastos.filter((g) => g.fecha === hoy && g.ticket_numero != null).map((g) => g.ticket_numero as number))];
    const porNumero = new Map(tickets.map((t) => [t.numero, t] as const));
    const deHoy = numerosHoy
      .map((numero) => {
        const t: TicketFila | undefined = porNumero.get(numero);
        return {
          numero,
          id: t?.id ?? null,
          asunto: t?.asunto ?? "(ticket que no está en la lista)",
          cliente: t?.cliente_id ? (clientes.get(t.cliente_id) ?? null) : null,
          estado_codigo: t?.estado_codigo ?? null,
          usd: red(usdPorTicket.get(numero) ?? 0),
          vueltas: vueltasPorTicket.get(numero) ?? 0,
        };
      })
      .sort((a, b) => b.usd - a.usd);

    const vueltas = [...vueltasPorTicket.values()];
    return ok({
      agente: agente ? { id: agente.id, nombre: agente.nombre ?? "Neurita" } : null,
      gasto: { hoy: red(usdHoy), mes: red(usdMes), total: red(usdTotal), topeMes: TOPE_MES_USD, vueltasHoy },
      trabajo: {
        resueltos: mio.resueltos,
        abiertos,
        costoPorTicket: mio.resueltos ? red(usdTotal / mio.resueltos) : null,
        medianaMinutos: mio.medianaMinutos == null ? null : Math.round(mio.medianaMinutos),
        vueltasMediana: mediana(vueltas),
        volvieron: mio.volvieron,
        ticketsConGasto: vueltasPorTicket.size,
      },
      hoy: deHoy,
      comparativo,
    });
  } catch (e) {
    return errorInesperado(e);
  }
}
