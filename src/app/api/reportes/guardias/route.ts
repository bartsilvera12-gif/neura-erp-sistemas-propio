import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireModulosApiAccess } from "@/lib/contabilidad/contabilidad-auth";

export const runtime = "nodejs";

/**
 * GET /api/reportes/guardias
 *
 * Reporte de guardias de Soporte: por mes, qué semanas hubo y quién estuvo de
 * guardia (PM / soporte principal / suplente), los cambios de dev registrados
 * (intercambios principal ↔ suplente, con su motivo) y los tickets que el
 * principal o el suplente resolvieron DURANTE su semana de guardia, con link a
 * cada ticket.
 *
 * Modelo: `guardias_semana` (una fila por semana, lunes como clave; tres roles
 * en columnas), `guardias_intercambios` (traza de cambios) y `soporte_tickets`
 * (resueltos = estado resuelto/cerrado con `resuelto_at`). Horarios en hora de
 * Paraguay; `resuelto_at`/`created_at` vienen en UTC.
 */

type GuardiaRow = {
  semana_inicio: string;
  pm_id: string | null;
  soporte_principal_id: string | null;
  soporte_suplente_id: string | null;
};
type IntercambioRow = {
  semana_inicio: string;
  motivo: string | null;
  principal_anterior_id: string | null;
  principal_nuevo_id: string | null;
  realizado_por: string | null;
  created_at: string;
};
type TicketRow = {
  id: string;
  numero: number | null;
  asunto: string | null;
  estado_codigo: string | null;
  responsable_id: string | null;
  resuelto_at: string | null;
};

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const MES_AB = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Fecha (YYYY-MM-DD) en hora de Paraguay de un timestamptz UTC. */
const fmtDiaPY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Asuncion", year: "numeric", month: "2-digit", day: "2-digit",
});
/** Fecha+hora legible en hora de Paraguay. */
const fmtHoraPY = new Intl.DateTimeFormat("es-PY", {
  timeZone: "America/Asuncion", day: "numeric", month: "short",
  hour: "2-digit", minute: "2-digit", hour12: false,
});

function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function addDays(ymd: string, n: number): string {
  const d = parseYmd(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function rangoLabel(lunes: string): string {
  const ini = parseYmd(lunes);
  const fin = parseYmd(addDays(lunes, 6));
  const di = ini.getUTCDate(), mi = ini.getUTCMonth();
  const df = fin.getUTCDate(), mf = fin.getUTCMonth();
  return mi === mf ? `${di} – ${df} ${MES_AB[mi]}` : `${di} ${MES_AB[mi]} – ${df} ${MES_AB[mf]}`;
}

export async function GET(request: NextRequest) {
  // Reportería del equipo: admin, o quien tenga el módulo Soporte o Clientes.
  const auth = await requireModulosApiAccess(request, ["soporte", "clientes"], "Reportes");
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    // 1) Guardias de la empresa, ordenadas por semana.
    const { data: gData, error: gErr } = await sb
      .from("guardias_semana")
      .select("semana_inicio, pm_id, soporte_principal_id, soporte_suplente_id")
      .eq("empresa_id", auth.empresaId)
      .order("semana_inicio", { ascending: true });
    if (gErr) return NextResponse.json(errorResponse(gErr.message), { status: 500 });
    const guardias = (gData ?? []) as GuardiaRow[];

    if (guardias.length === 0) {
      return NextResponse.json(
        successResponse({ rango: null, totales: { semanas: 0, tickets: 0, intercambios: 0 }, meses: [] }),
      );
    }

    const desde = guardias[0].semana_inicio;
    const hasta = addDays(guardias[guardias.length - 1].semana_inicio, 7); // exclusivo

    // 2) Nombres de usuarios involucrados (roles).
    const userIds = new Set<string>();
    for (const g of guardias) {
      for (const id of [g.pm_id, g.soporte_principal_id, g.soporte_suplente_id]) if (id) userIds.add(id);
    }

    // 3) Intercambios (traza de cambios de dev). Drift-safe: si la tabla no
    //    existe en este tenant, el reporte sigue sin los cambios.
    let intercambios: IntercambioRow[] = [];
    try {
      const { data: iData } = await sb
        .from("guardias_intercambios")
        .select("semana_inicio, motivo, principal_anterior_id, principal_nuevo_id, realizado_por, created_at")
        .eq("empresa_id", auth.empresaId)
        .order("created_at", { ascending: true });
      intercambios = (iData ?? []) as IntercambioRow[];
      for (const i of intercambios) {
        for (const id of [i.principal_anterior_id, i.principal_nuevo_id, i.realizado_por]) if (id) userIds.add(id);
      }
    } catch {
      /* tenant sin tabla de intercambios */
    }

    // 4) Tickets resueltos en el rango de las guardias. Drift-safe.
    let tickets: TicketRow[] = [];
    try {
      const { data: tData } = await sb
        .from("soporte_tickets")
        .select("id, numero, asunto, estado_codigo, responsable_id, resuelto_at")
        .eq("empresa_id", auth.empresaId)
        .in("estado_codigo", ["resuelto", "cerrado"])
        .not("resuelto_at", "is", null)
        .gte("resuelto_at", desde)
        .lt("resuelto_at", hasta)
        .limit(20000);
      tickets = (tData ?? []) as TicketRow[];
    } catch {
      /* tenant sin módulo Soporte */
    }

    // 5) Nombres (una sola consulta).
    const nombreById = new Map<string, string>();
    if (userIds.size > 0) {
      const { data: uData } = await sb.from("usuarios").select("id, nombre").in("id", Array.from(userIds));
      for (const u of (uData ?? []) as { id: string; nombre: string | null }[]) {
        nombreById.set(u.id, u.nombre ?? "—");
      }
    }
    const nombre = (id: string | null) => (id ? nombreById.get(id) ?? "—" : "—");

    // 6) Tickets por día (hora Paraguay) para bucketear en la semana correcta.
    const ticketsPorDia = new Map<string, TicketRow[]>();
    for (const t of tickets) {
      if (!t.resuelto_at) continue;
      const d = new Date(t.resuelto_at);
      if (Number.isNaN(d.getTime())) continue;
      const dia = fmtDiaPY.format(d); // YYYY-MM-DD en PY
      if (!ticketsPorDia.has(dia)) ticketsPorDia.set(dia, []);
      ticketsPorDia.get(dia)!.push(t);
    }

    // 7) Armar semanas con roles, cambios y tickets de sus devs de guardia.
    type SemanaOut = {
      semana_inicio: string;
      rango: string;
      pm: string;
      principal: string;
      suplente: string;
      swaps: { de: string; a: string; motivo: string; por: string; cuando: string }[];
      tickets: { id: string; numero: number | null; asunto: string; responsable: string; resuelto: string; estado: string }[];
    };
    const semanas: SemanaOut[] = guardias.map((g) => {
      const lunes = g.semana_inicio;
      const devIds = new Set<string>([g.soporte_principal_id, g.soporte_suplente_id].filter(Boolean) as string[]);
      const tks: SemanaOut["tickets"] = [];
      for (let k = 0; k < 7; k++) {
        const dia = addDays(lunes, k);
        for (const t of ticketsPorDia.get(dia) ?? []) {
          if (t.responsable_id && devIds.has(t.responsable_id)) {
            tks.push({
              id: t.id,
              numero: t.numero,
              asunto: t.asunto ?? "(sin asunto)",
              responsable: nombre(t.responsable_id),
              resuelto: t.resuelto_at ? fmtHoraPY.format(new Date(t.resuelto_at)) : "",
              estado: t.estado_codigo === "cerrado" ? "cerrado" : "resuelto",
            });
          }
        }
      }
      tks.sort((a, b) => (a.numero ?? 0) - (b.numero ?? 0));
      const swaps = intercambios
        .filter((i) => i.semana_inicio === lunes)
        .map((i) => ({
          de: nombre(i.principal_anterior_id),
          a: nombre(i.principal_nuevo_id),
          motivo: i.motivo ?? "(sin motivo)",
          por: nombre(i.realizado_por),
          cuando: fmtHoraPY.format(new Date(i.created_at)),
        }));
      return {
        semana_inicio: lunes,
        rango: rangoLabel(lunes),
        pm: nombre(g.pm_id),
        principal: nombre(g.soporte_principal_id),
        suplente: nombre(g.soporte_suplente_id),
        swaps,
        tickets: tks,
      };
    });

    // 8) Agrupar por mes (del lunes de la semana).
    const meses: { key: string; nombre: string; semanas: SemanaOut[]; tickets: number }[] = [];
    for (const s of semanas) {
      const d = parseYmd(s.semana_inicio);
      const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
      let m = meses.find((x) => x.key === key);
      if (!m) {
        m = { key, nombre: `${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}`, semanas: [], tickets: 0 };
        meses.push(m);
      }
      m.semanas.push(s);
      m.tickets += s.tickets.length;
    }

    return NextResponse.json(
      successResponse({
        rango: { desde, hasta: addDays(hasta, -1) },
        totales: {
          semanas: semanas.length,
          tickets: semanas.reduce((a, s) => a + s.tickets.length, 0),
          intercambios: intercambios.length,
        },
        meses,
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al generar el reporte de guardias";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
