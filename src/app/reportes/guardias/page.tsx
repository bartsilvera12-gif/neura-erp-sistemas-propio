"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ShieldCheck, ArrowLeftRight, Ticket, ChevronRight, ChevronDown, Search, X, Users } from "lucide-react";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";

interface Swap {
  de: string;
  a: string;
  motivo: string;
  por: string;
  cuando: string;
}
interface TicketItem {
  id: string;
  numero: number | null;
  asunto: string;
  responsable: string;
  resuelto: string;
  estado: string;
}
interface Semana {
  semana_inicio: string;
  rango: string;
  pm: string;
  principal: string;
  suplente: string;
  swaps: Swap[];
  tickets: TicketItem[];
}
interface Mes {
  key: string;
  nombre: string;
  semanas: Semana[];
  tickets: number;
}
interface Data {
  rango: { desde: string; hasta: string } | null;
  totales: { semanas: number; tickets: number; intercambios: number };
  meses: Mes[];
}

const MINUSCULAS = new Set(["al", "de", "del", "la", "el", "los", "las", "y"]);
function titulo(n: string): string {
  if (!n || n === "—") return "—";
  return n
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (MINUSCULAS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}
/** Normaliza para búsqueda: minúsculas y sin tildes. */
function norm(s: string): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

const TODOS = "__todos__";

function Persona({ rol, nombre, color }: { rol: string; nombre: string; color: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-slate-400">{rol}</p>
      <p className={`truncate text-sm font-semibold ${color}`} title={titulo(nombre)}>
        {titulo(nombre)}
      </p>
    </div>
  );
}

function SemanaCard({
  s,
  tickets,
  abierto,
  autoAbierto,
  onToggle,
}: {
  s: Semana;
  tickets: TicketItem[];
  abierto: boolean;
  autoAbierto: boolean;
  onToggle: () => void;
}) {
  const conSwap = s.swaps.length > 0;
  return (
    <article
      className={`overflow-hidden rounded-2xl border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] ${
        conSwap ? "border-amber-300" : "border-slate-200"
      }`}
    >
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 p-4">
        <h3 className="whitespace-nowrap text-base font-semibold tracking-tight text-slate-900">{s.rango}</h3>
        <div className="flex min-w-0 flex-wrap gap-x-6 gap-y-2">
          <Persona rol="PM" nombre={s.pm} color="text-amber-700" />
          <Persona rol="Principal" nombre={s.principal} color="text-[#2d8a8f]" />
          <Persona rol="Suplente" nombre={s.suplente} color="text-slate-700" />
        </div>
      </header>

      {conSwap && (
        <div className="mx-4 mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-amber-700">
            <ArrowLeftRight className="h-3.5 w-3.5" />
            Cambio de dev en la guardia
          </div>
          <ul className="space-y-2">
            {s.swaps.map((w, i) => (
              <li key={i} className="text-sm">
                <p className="font-semibold text-slate-900">
                  {titulo(w.de)} <span className="text-amber-600">→</span> {titulo(w.a)}
                </p>
                <p className="text-slate-700">{w.motivo}</p>
                <p className="text-[11px] tabular-nums text-slate-400">
                  {w.cuando} · por {titulo(w.por)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="border-t border-slate-100">
        <button
          type="button"
          onClick={onToggle}
          disabled={autoAbierto || tickets.length === 0}
          className="flex w-full items-center gap-2 px-4 py-3 text-left disabled:cursor-default"
        >
          <Ticket className="h-3.5 w-3.5 text-slate-400" />
          <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-slate-500">Tickets resueltos</span>
          <span className="rounded-full bg-[#4FAEB2]/12 px-2 py-0.5 text-xs tabular-nums text-[#2d8a8f]">
            {tickets.length}
          </span>
          {!autoAbierto && tickets.length > 0 && (
            <ChevronDown
              className={`ml-auto h-4 w-4 text-slate-400 transition-transform ${abierto ? "rotate-180" : ""}`}
            />
          )}
        </button>

        {tickets.length === 0 ? (
          <p className="px-4 pb-4 text-sm italic text-slate-400">Sin tickets para los filtros actuales.</p>
        ) : (
          abierto && (
            <ul className="space-y-1 px-4 pb-4">
              {tickets.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/dashboard/soporte/tickets/${t.id}`}
                    className="group flex items-baseline gap-2.5 rounded-lg border border-transparent px-2.5 py-1.5 transition-colors hover:border-slate-200 hover:bg-[#4FAEB2]/6"
                  >
                    <span className="whitespace-nowrap font-semibold tabular-nums text-[#2d8a8f]">#{t.numero}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{t.asunto}</span>
                    <span className="hidden whitespace-nowrap text-[11px] tabular-nums text-slate-400 sm:inline">
                      {titulo(t.responsable)} · {t.resuelto}
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 group-hover:text-[#4FAEB2]" />
                  </Link>
                </li>
              ))}
            </ul>
          )
        )}
      </div>
    </article>
  );
}

export default function GuardiasReportePage() {
  const [data, setData] = useState<Data | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mesSel, setMesSel] = useState<string>(TODOS);
  const [devSel, setDevSel] = useState<string>(TODOS);
  const [query, setQuery] = useState("");
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());

  useEffect(() => {
    let vivo = true;
    (async () => {
      setCargando(true);
      setError(null);
      try {
        const r = await apiFetch("/api/reportes/guardias");
        const j = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (!r.ok || !j?.data) {
          setError(j?.message || "No se pudo cargar el reporte.");
          setData(null);
        } else {
          const d = j.data as Data;
          setData(d);
          // Entrada calma: arranca en el mes más reciente, no en todo.
          if (d.meses.length > 0) setMesSel(d.meses[d.meses.length - 1].key);
        }
      } catch {
        if (vivo) setError("No se pudo cargar el reporte.");
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  // Lista de desarrolladores (principal/suplente) y resumen por persona.
  const { devs, resumen } = useMemo(() => {
    const semanasPorDev = new Map<string, number>();
    const ticketsPorDev = new Map<string, number>();
    const set = new Set<string>();
    for (const m of data?.meses ?? []) {
      for (const s of m.semanas) {
        for (const d of [s.principal, s.suplente]) {
          if (d && d !== "—") {
            set.add(d);
            semanasPorDev.set(d, (semanasPorDev.get(d) ?? 0) + 1);
          }
        }
        for (const t of s.tickets) {
          if (t.responsable && t.responsable !== "—") {
            ticketsPorDev.set(t.responsable, (ticketsPorDev.get(t.responsable) ?? 0) + 1);
          }
        }
      }
    }
    const resumen = Array.from(set)
      .map((n) => ({ nombre: n, semanas: semanasPorDev.get(n) ?? 0, tickets: ticketsPorDev.get(n) ?? 0 }))
      .sort((a, b) => b.tickets - a.tickets || b.semanas - a.semanas);
    return { devs: resumen.map((r) => r.nombre), resumen };
  }, [data]);

  const tokens = useMemo(() => norm(query.trim()).split(/\s+/).filter(Boolean), [query]);
  const buscando = tokens.length > 0;

  // Mes efectivo: al buscar, la búsqueda es global (ignora el mes elegido).
  const mesEfectivo = buscando ? TODOS : mesSel;

  function filtrarTickets(s: Semana): TicketItem[] {
    let tks = s.tickets;
    if (devSel !== TODOS) tks = tks.filter((t) => t.responsable === devSel);
    if (tokens.length) {
      tks = tks.filter((t) => {
        const h = norm(`#${t.numero} ${t.asunto} ${t.responsable}`);
        return tokens.every((tok) => h.includes(tok));
      });
    }
    return tks;
  }

  const vista = useMemo(() => {
    if (!data) return { meses: [] as { mes: Mes; semanas: { s: Semana; tickets: TicketItem[] }[] }[], semanas: 0, tickets: 0 };
    let totSem = 0;
    let totTk = 0;
    const meses = data.meses
      .filter((m) => mesEfectivo === TODOS || m.key === mesEfectivo)
      .map((m) => {
        const semanas = m.semanas
          .map((s) => ({ s, tickets: filtrarTickets(s) }))
          .filter(({ s, tickets }) => {
            const involucra = devSel === TODOS || s.principal === devSel || s.suplente === devSel;
            if (buscando) return tickets.length > 0;
            if (devSel !== TODOS) return involucra || tickets.length > 0;
            return true;
          });
        return { mes: m, semanas };
      })
      .filter((x) => x.semanas.length > 0);
    for (const m of meses) {
      totSem += m.semanas.length;
      for (const w of m.semanas) totTk += w.tickets.length;
    }
    return { meses, semanas: totSem, tickets: totTk };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, mesEfectivo, devSel, tokens, buscando]);

  const autoAbierto = buscando || devSel !== TODOS;
  const hayFiltro = mesSel !== TODOS || devSel !== TODOS || buscando;

  function limpiar() {
    setQuery("");
    setDevSel(TODOS);
    if (data && data.meses.length > 0) setMesSel(data.meses[data.meses.length - 1].key);
  }

  return (
    <div className="w-full min-w-0 max-w-full space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#4FAEB2]/12 text-[#2d8a8f]">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">Atención</p>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Guardias</h1>
        <p className="mt-1 text-sm text-slate-500">
          Quién estuvo de guardia, los cambios de dev y los tickets que resolvieron. Elegí un mes o un desarrollador, o
          buscá un ticket. Horarios en hora de Paraguay.
        </p>
      </div>

      {cargando && <p className="text-sm text-slate-500">Cargando…</p>}
      {error && !cargando && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>
      )}

      {data && !cargando && (
        <>
          {/* KPIs */}
          <div className="flex flex-wrap gap-3">
            {[
              { n: data.totales.semanas, l: "Semanas" },
              { n: data.totales.tickets, l: "Tickets resueltos" },
              { n: data.totales.intercambios, l: "Cambios de dev" },
            ].map((k) => (
              <div key={k.l} className="min-w-[120px] rounded-xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-xl font-bold tabular-nums text-slate-900">{k.n}</p>
                <p className="text-[11px] uppercase tracking-[0.06em] text-slate-400">{k.l}</p>
              </div>
            ))}
          </div>

          {/* Resumen por persona (clickeable para filtrar) */}
          {resumen.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.06em] text-slate-500">
                <Users className="h-3.5 w-3.5" /> Resumen por desarrollador
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {resumen.map((r) => {
                  const activo = devSel === r.nombre;
                  return (
                    <button
                      key={r.nombre}
                      type="button"
                      onClick={() => {
                        setQuery("");
                        setDevSel(activo ? TODOS : r.nombre);
                      }}
                      className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${
                        activo
                          ? "border-[#4FAEB2] bg-[#4FAEB2]/8"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <span className="min-w-0 truncate text-sm font-semibold text-slate-800">{titulo(r.nombre)}</span>
                      <span className="flex shrink-0 gap-3 text-[11px] tabular-nums text-slate-500">
                        <span>
                          <b className="text-slate-800">{r.semanas}</b> sem
                        </span>
                        <span>
                          <b className="text-[#2d8a8f]">{r.tickets}</b> tk
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Controles: mes + buscador */}
          <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white/95 px-3 py-2.5 backdrop-blur">
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() => setMesSel(TODOS)}
                disabled={buscando}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 ${
                  mesEfectivo === TODOS ? "bg-[#4FAEB2] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                Todos
              </button>
              {data.meses.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setMesSel(m.key)}
                  disabled={buscando}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition-colors disabled:opacity-40 ${
                    mesEfectivo === m.key ? "bg-[#4FAEB2] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {m.nombre.replace(/ \d{4}$/, "")}
                </button>
              ))}
            </div>

            <div className="relative ml-auto min-w-[200px] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="buscar-ticket"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar ticket (n.º, asunto, dev)…"
                className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-8 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  aria-label="Limpiar búsqueda"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {/* Línea de estado de filtros */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="tabular-nums">
              {vista.semanas} {vista.semanas === 1 ? "semana" : "semanas"} · {vista.tickets} tickets
            </span>
            {devSel !== TODOS && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#4FAEB2]/10 px-2 py-0.5 font-medium text-[#2d8a8f]">
                {titulo(devSel)}
                <button type="button" onClick={() => setDevSel(TODOS)} aria-label="Quitar filtro de dev">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {buscando && <span className="text-slate-400">buscando en todos los meses</span>}
            {hayFiltro && (
              <button type="button" onClick={limpiar} className="font-medium text-[#2d8a8f] hover:underline">
                Limpiar filtros
              </button>
            )}
          </div>

          {/* Resultados */}
          {vista.meses.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
              No hay resultados para estos filtros.
            </p>
          ) : (
            vista.meses.map(({ mes, semanas }) => (
              <section key={mes.key} className="space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-slate-200 pb-2">
                  <h2 className="text-lg font-semibold capitalize tracking-tight text-slate-900">{mes.nombre}</h2>
                  <span className="text-xs tabular-nums text-slate-400">
                    {semanas.length} {semanas.length === 1 ? "semana" : "semanas"} ·{" "}
                    {semanas.reduce((a, w) => a + w.tickets.length, 0)} tickets
                  </span>
                </div>
                <div className="space-y-3">
                  {semanas.map(({ s, tickets }) => (
                    <SemanaCard
                      key={s.semana_inicio}
                      s={s}
                      tickets={tickets}
                      autoAbierto={autoAbierto}
                      abierto={autoAbierto || abiertas.has(s.semana_inicio)}
                      onToggle={() =>
                        setAbiertas((prev) => {
                          const next = new Set(prev);
                          if (next.has(s.semana_inicio)) next.delete(s.semana_inicio);
                          else next.add(s.semana_inicio);
                          return next;
                        })
                      }
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </>
      )}
    </div>
  );
}
