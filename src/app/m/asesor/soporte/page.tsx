"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Clock, Plus, Search, Ticket } from "lucide-react";
import { apiSoporte } from "@/app/dashboard/soporte/_ui/api";
import { numeroTicket } from "@/lib/soporte/dominio";
import { puedeCargarSoporte } from "@/app/dashboard/conversaciones/SoporteTicketModal";
import AsesorTabBar from "../AsesorTabBar";

// El mismo formulario del escritorio y del chat. Se carga recién al abrirlo.
const SoporteTicketModal = dynamic(() => import("@/app/dashboard/conversaciones/SoporteTicketModal"), {
  ssr: false,
});
import { Chip, PESTANAS, slaVencido, tonoEstado, tonoPestana, tonoPrioridad, type PestanaId, type TicketMovil } from "./_comun";

/**
 * Soporte en la app del asesor, con las mismas funciones que la app nativa: Mis tickets /
 * Todos, pestañas por estado con contador, búsqueda por asunto o #número, y el detalle con
 * cambio de estado, prioridad, subtareas y comentarios.
 *
 * Antes la pestaña abría el módulo de escritorio (/dashboard/soporte/tickets), pensado para
 * pantalla grande y sin "Mis tickets".
 */
export default function MAsesorSoportePage() {
  const [mios, setMios] = useState(true);
  // Cargar un ticket desde acá, sin pasar por un chat. Solo para quien puede (PM o Soporte).
  const [puedeCargar, setPuedeCargar] = useState(false);
  const [cargandoTicket, setCargandoTicket] = useState(false);
  useEffect(() => {
    let vivo = true;
    void puedeCargarSoporte().then((p) => vivo && setPuedeCargar(p));
    return () => {
      vivo = false;
    };
  }, []);
  const [pestana, setPestana] = useState<PestanaId>("todos");
  const [q, setQ] = useState("");
  const [tickets, setTickets] = useState<TicketMovil[]>([]);
  const [contadores, setContadores] = useState<Record<string, number>>({});
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pedido = useRef(0);

  const cargar = useCallback(async () => {
    const n = ++pedido.current;
    const p = new URLSearchParams({ pestana, por_pagina: "100" });
    if (mios) p.set("mios", "1");
    if (q.trim()) p.set("q", q.trim());
    try {
      const r = await apiSoporte<{ tickets: TicketMovil[]; contadores: Record<string, number> }>(
        `/api/soporte/tickets?${p.toString()}`
      );
      if (n !== pedido.current) return;
      setTickets(r.tickets ?? []);
      setContadores(r.contadores ?? {});
      setError(null);
    } catch (e) {
      if (n !== pedido.current) return;
      setError(e instanceof Error ? e.message : "No se pudo cargar");
    } finally {
      if (n === pedido.current) setCargando(false);
    }
  }, [mios, pestana, q]);

  // La búsqueda espera a que se deje de escribir; el resto recarga al instante.
  useEffect(() => {
    const t = window.setTimeout(() => void cargar(), q ? 350 : 0);
    return () => window.clearTimeout(t);
  }, [cargar, q]);

  return (
    <div className="flex h-svh min-h-0 flex-col bg-slate-50">
      <header
        className="z-10 shrink-0 bg-[#3F8E91] px-4 pb-3 text-white shadow-sm"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold">Soporte</h1>
            <p className="text-[11px] text-white/80">Tickets</p>
          </div>
          {puedeCargar ? (
            <button
              type="button"
              onClick={() => setCargandoTicket(true)}
              className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-full bg-white/95 px-3.5 text-[13px] font-semibold text-[#3F8E91] shadow-sm active:bg-white"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Nuevo
            </button>
          ) : null}
        </div>

        <div className="mt-2 grid grid-cols-2 rounded-xl bg-white/15 p-0.5" role="radiogroup" aria-label="Alcance">
          {[
            { v: true, label: "Mis tickets" },
            { v: false, label: "Todos" },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              role="radio"
              aria-checked={mios === o.v}
              onClick={() => {
                setCargando(tickets.length === 0);
                setMios(o.v);
              }}
              className={`rounded-[10px] py-1.5 text-[13px] font-semibold transition-colors ${
                mios === o.v ? "bg-white text-[#3F8E91] shadow-sm" : "text-white/90"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        <label className="mt-2 flex items-center gap-2 rounded-xl bg-white/95 px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          <input
            type="search"
            inputMode="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar asunto o #número"
            className="w-full bg-transparent text-[13px] text-slate-800 outline-none placeholder:text-slate-400"
            aria-label="Buscar ticket"
          />
        </label>
      </header>

      <div className="shrink-0 border-b border-slate-100 bg-white">
        <div className="flex gap-2 overflow-x-auto px-4 py-2.5 [scrollbar-width:none]" role="radiogroup" aria-label="Estado">
          {PESTANAS.map((p) => {
            const activa = p.id === pestana;
            const tono = tonoPestana(p.id);
            const n = contadores[p.id];
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={activa}
                onClick={() => setPestana(p.id)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors"
                style={activa ? { backgroundColor: tono.solido, color: "#fff" } : { backgroundColor: "#F1F5F9", color: "#475569" }}
              >
                {p.etiqueta}
                {n ? <span className="text-[11px] opacity-70">{n}</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3 py-3">
        {cargando ? (
          <p className="p-6 text-center text-sm text-slate-400 animate-pulse">Cargando…</p>
        ) : error && tickets.length === 0 ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
            <button type="button" onClick={() => void cargar()} className="ml-2 underline">
              Reintentar
            </button>
          </div>
        ) : tickets.length === 0 ? (
          <div className="p-10 text-center">
            <Ticket className="mx-auto h-8 w-8 text-slate-300" aria-hidden />
            <p className="mt-2 text-sm text-slate-500">
              {q.trim() ? `Sin resultados para “${q.trim()}”.` : "No hay tickets en esta pestaña."}
            </p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {tickets.map((t) => {
              const tono = tonoEstado(t.estado_codigo);
              return (
                <li key={t.id}>
                  <Link
                    href={`/m/asesor/soporte/${t.id}`}
                    className="relative block rounded-2xl border border-slate-200 bg-white py-3.5 pl-5 pr-3.5 active:bg-slate-50"
                  >
                    <span
                      aria-hidden
                      className="absolute bottom-3.5 left-2 top-3.5 w-[3px] rounded-full"
                      style={{ backgroundColor: tono.solido }}
                    />
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12px] font-semibold tabular-nums text-slate-500">{numeroTicket(t.numero)}</span>
                      <Chip texto={t.estado_nombre ?? t.estado_codigo} tono={tono} />
                      {t.prioridad_nombre ? <Chip texto={t.prioridad_nombre} tono={tonoPrioridad(t.prioridad_codigo)} /> : null}
                      {slaVencido(t) ? <Clock className="ml-auto h-3.5 w-3.5 text-rose-500" aria-label="SLA vencido" /> : null}
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-[15px] font-semibold leading-snug text-slate-900">{t.asunto ?? "Sin asunto"}</p>
                    <p className="mt-1 truncate text-[12px] text-slate-500">
                      {[t.cliente_nombre, t.responsable?.nombre].filter(Boolean).join(" · ")}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      {cargandoTicket ? (
        <SoporteTicketModal
          conversationId=""
          clienteId={null}
          contacto=""
          telefono={null}
          alCerrar={() => {
            setCargandoTicket(false);
            void cargar();
          }}
        />
      ) : null}

      <AsesorTabBar />
    </div>
  );
}
