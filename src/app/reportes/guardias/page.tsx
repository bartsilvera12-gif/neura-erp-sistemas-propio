"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck, ArrowLeftRight, Ticket, ChevronRight } from "lucide-react";
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
/** Nombres guardados en MAYÚSCULAS: a Capitalizado legible. */
function titulo(n: string): string {
  if (!n || n === "—") return "—";
  return n
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (MINUSCULAS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

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

function SemanaCard({ s }: { s: Semana }) {
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

      <div className="border-t border-slate-100 p-4">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.06em] text-slate-400">
          <Ticket className="h-3.5 w-3.5" />
          Tickets resueltos
          <span className="rounded-full bg-[#4FAEB2]/12 px-2 py-0.5 text-xs tabular-nums text-[#2d8a8f]">
            {s.tickets.length}
          </span>
        </div>
        {s.tickets.length === 0 ? (
          <p className="text-sm italic text-slate-400">Sin tickets resueltos por los de guardia esta semana.</p>
        ) : (
          <ul className="space-y-1">
            {s.tickets.map((t) => (
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
        )}
      </div>
    </article>
  );
}

export default function GuardiasReportePage() {
  const [data, setData] = useState<Data | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          setData(j.data as Data);
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

  return (
    <div className="w-full min-w-0 max-w-full space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#4FAEB2]/12 text-[#2d8a8f]"
          >
            <ShieldCheck className="h-4 w-4" />
          </span>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">Atención</p>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Guardias</h1>
        <p className="mt-1 text-sm text-slate-500">
          Quién estuvo de guardia cada semana, los cambios de dev con su motivo y los tickets que resolvieron. Horarios en
          hora de Paraguay. Tocá un ticket para abrirlo.
        </p>
      </div>

      {cargando && <p className="text-sm text-slate-500">Cargando…</p>}
      {error && !cargando && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>
      )}

      {data && !cargando && (
        <>
          <div className="flex flex-wrap gap-3">
            <div className="min-w-[120px] rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-xl font-bold tabular-nums text-slate-900">{data.totales.semanas}</p>
              <p className="text-[11px] uppercase tracking-[0.06em] text-slate-400">Semanas</p>
            </div>
            <div className="min-w-[120px] rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-xl font-bold tabular-nums text-slate-900">{data.totales.tickets}</p>
              <p className="text-[11px] uppercase tracking-[0.06em] text-slate-400">Tickets resueltos</p>
            </div>
            <div className="min-w-[120px] rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-xl font-bold tabular-nums text-slate-900">{data.totales.intercambios}</p>
              <p className="text-[11px] uppercase tracking-[0.06em] text-slate-400">Cambios de dev</p>
            </div>
          </div>

          {data.meses.length === 0 && (
            <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              Todavía no hay guardias cargadas.
            </p>
          )}

          {data.meses.map((m) => (
            <section key={m.key} className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-slate-200 pb-2">
                <h2 className="text-lg font-semibold capitalize tracking-tight text-slate-900">{m.nombre}</h2>
                <span className="text-xs tabular-nums text-slate-400">
                  {m.semanas.length} semanas · {m.tickets} tickets
                </span>
              </div>
              <div className="space-y-3">
                {m.semanas.map((s) => (
                  <SemanaCard key={s.semana_inicio} s={s} />
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
