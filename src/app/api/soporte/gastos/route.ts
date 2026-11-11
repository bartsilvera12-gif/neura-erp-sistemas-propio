import { requireSoporteApi } from "@/lib/soporte/soporte-auth";
import { errorInesperado, falla, ok, sinPermiso } from "@/lib/soporte/servidor";
import { TZ_PY } from "@/lib/format/hora-py";

/** Fecha de hoy en Paraguay como YYYY-MM-DD. */
function hoyPy(): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ_PY, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Un gasto desorbitado es casi siempre un error de quien informa, no un gasto real. */
const MAX_USD_POR_AVISO = 1000;

type FilaGasto = { fecha: string; usd: number | string | null };

/**
 * GET /api/soporte/gastos
 *
 * Lo que lleva gastado el agente de IA: hoy (hora de Paraguay), este mes y
 * desde siempre. Lo ve cualquiera que entre a Soporte.
 */
export async function GET(request: Request) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  try {
    // Una fila por vuelta del modelo: son pocas por día y se suman acá. Si algún
    // día el volumen crece, esto pasa a una vista agregada en la base.
    const { data, error } = await auth.sb
      .from("soporte_agente_gastos")
      .select("fecha, usd")
      .eq("empresa_id", auth.empresaId)
      .limit(100_000);
    if (error) return falla(error.message);

    const hoy = hoyPy();
    const mes = hoy.slice(0, 7);
    let usdHoy = 0;
    let usdMes = 0;
    let usdTotal = 0;
    for (const f of (data ?? []) as FilaGasto[]) {
      const usd = Number(f.usd ?? 0);
      if (!Number.isFinite(usd)) continue;
      usdTotal += usd;
      if (f.fecha === hoy) usdHoy += usd;
      if (typeof f.fecha === "string" && f.fecha.startsWith(mes)) usdMes += usd;
    }
    const red = (n: number) => Math.round(n * 100) / 100;
    return ok({ hoy: red(usdHoy), mes: red(usdMes), total: red(usdTotal), vueltas: data?.length ?? 0 });
  } catch (e) {
    return errorInesperado(e);
  }
}

/**
 * POST /api/soporte/gastos — lo usa el agente para informar lo que gastó.
 *
 * Cuerpo: { usd, ticket_numero?, fecha?, detalle? }. `fecha` es el día de
 * Paraguay de quien informa; si no viene, se toma el de hoy.
 *
 * La tabla es de solo agregar: no hay forma de editar ni borrar un aviso.
 */
export async function POST(request: Request) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  try {
    const body = (await request.json().catch(() => null)) as
      | { usd?: unknown; ticket_numero?: unknown; fecha?: unknown; detalle?: unknown }
      | null;
    if (!body) return falla("Cuerpo inválido");

    const usd = Number(body.usd);
    if (!Number.isFinite(usd) || usd < 0) return falla("usd tiene que ser un número de dólares");
    if (usd > MAX_USD_POR_AVISO) return falla(`usd ${usd} es demasiado para un solo aviso`);
    // Una vuelta que no gastó nada no aporta nada a la suma.
    if (usd === 0) return ok({ guardado: false });

    const fecha = typeof body.fecha === "string" && RE_FECHA.test(body.fecha) ? body.fecha : hoyPy();
    const ticket = Number(body.ticket_numero);
    const detalle = typeof body.detalle === "string" ? body.detalle.trim().slice(0, 200) : null;

    const { error } = await auth.sb.from("soporte_agente_gastos").insert({
      empresa_id: auth.empresaId,
      fecha,
      ticket_numero: Number.isInteger(ticket) && ticket > 0 ? ticket : null,
      usd: Math.round(usd * 10_000) / 10_000,
      detalle: detalle || null,
    });
    if (error) return falla(error.message);
    return ok({ guardado: true });
  } catch (e) {
    return errorInesperado(e);
  }
}
