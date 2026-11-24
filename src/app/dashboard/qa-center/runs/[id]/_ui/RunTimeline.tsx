"use client";

/**
 * Timeline en vivo del agente QA, reescrito con lenguaje natural.
 *
 * Mismo polling que la versión anterior (`/api/qa/runs/<id>/events`), pero:
 *  - Cada evento pasa por el humanizador antes de pintarse.
 *  - Los íconos y colores comunican estado de un vistazo.
 *  - Los grupos por módulo están plegables.
 *  - El indicador "siguiendo" late con un dot animado.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { humanizarEvento, etiquetaDeFase, etiquetaDeModulo, type EventoHumano } from "./event-humanizer";

type RunEvent = {
  id: string;
  ts: string;
  fase: string;
  modulo: string | null;
  submodulo: string | null;
  accion: string | null;
  estado: string;
  mensaje: string | null;
  evidence_path: string | null;
  payload: Record<string, unknown> | null;
};

type ApiResponse = {
  data: RunEvent[];
  run_status: string;
  last_ts: string | null;
};

const POLL_INTERVAL_MS = 2_000;
const TERMINAL_STATES = new Set(["passed", "failed", "aborted", "error"]);

type Props = {
  runId: string;
  initialStatus: string;
};

export default function RunTimeline({ runId, initialStatus }: Props) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [status, setStatus] = useState<string>(initialStatus);
  const [err, setErr] = useState<string | null>(null);
  const [colapsados, setColapsados] = useState<Record<string, boolean>>({});
  const [seguirAlFinal, setSeguirAlFinal] = useState(true);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const lastTsRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const scrollBoxRef = useRef<HTMLDivElement | null>(null);

  const fetchOnce = useCallback(async (): Promise<boolean> => {
    try {
      const url = new URL(`/api/qa/runs/${runId}/events`, window.location.origin);
      if (lastTsRef.current) url.searchParams.set("since", lastTsRef.current);
      url.searchParams.set("limit", "200");
      const res = await fetch(url.pathname + url.search, { cache: "no-store" });
      const text = await res.text();
      let body: ApiResponse = { data: [], run_status: status, last_ts: null };
      try { body = text ? (JSON.parse(text) as ApiResponse) : body; } catch { /* ignore */ }
      if (!res.ok) { setErr(`HTTP ${res.status}`); return false; }
      const nuevos: RunEvent[] = [];
      for (const e of body.data) {
        if (!seenIdsRef.current.has(e.id)) {
          seenIdsRef.current.add(e.id);
          nuevos.push(e);
        }
      }
      if (nuevos.length > 0) {
        setEvents((prev) => [...prev, ...nuevos]);
        lastTsRef.current = nuevos[nuevos.length - 1]!.ts;
      }
      if (body.run_status !== status) setStatus(body.run_status);
      setErr(null);
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de red");
      return false;
    }
  }, [runId, status]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let finalPassDone = false;

    const loop = async (): Promise<void> => {
      if (cancelled) return;
      await fetchOnce();
      if (cancelled) return;
      const isTerminal = TERMINAL_STATES.has(status);
      if (isTerminal && finalPassDone) return;
      if (isTerminal) finalPassDone = true;
      timer = setTimeout(loop, POLL_INTERVAL_MS);
    };
    void loop();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [fetchOnce, status]);

  useEffect(() => {
    if (!seguirAlFinal) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [events.length, seguirAlFinal]);

  const agrupados = useMemo(() => {
    const map = new Map<string, RunEvent[]>();
    for (const e of events) {
      const k = e.modulo ?? "__general__";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    }
    return Array.from(map.entries());
  }, [events]);

  const enVivo = !TERMINAL_STATES.has(status);

  return (
    <section className="mb-6" data-testid="run-timeline">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">¿Qué está haciendo el agente?</h2>
          <p className="text-xs text-slate-500">Cada paso del agente QA, en orden y con contexto.</p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-500">
          <span data-testid="timeline-count" className="tabular-nums">{events.length} pasos</span>
          {enVivo ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 ring-1 ring-emerald-200">
              <span className="relative inline-flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              en vivo
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600 ring-1 ring-slate-200">
              finalizado
            </span>
          )}
          {err && <span className="text-rose-600">· {err}</span>}
        </div>
      </div>

      {events.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/50 px-4 py-10 text-center">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-sky-50 text-sky-600 ring-1 ring-sky-100">
            <span className="relative inline-flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-500" />
            </span>
          </div>
          <p className="text-sm font-medium text-slate-700">Preparando ejecución…</p>
          <p className="mt-1 text-xs text-slate-500">El runner está por lanzar el agente. Esto suele tardar unos segundos.</p>
        </div>
      ) : (
        <div
          ref={scrollBoxRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
            setSeguirAlFinal(atBottom);
          }}
          className="max-h-[560px] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-sm"
        >
          <ul className="divide-y divide-slate-100">
            {agrupados.map(([moduloKey, evs]) => {
              const colapsado = colapsados[moduloKey] ?? false;
              const label = etiquetaDeModulo(moduloKey);
              const failCount = evs.filter((e) => e.estado === "fail").length;
              const warnCount = evs.filter((e) => e.estado === "warn").length;
              return (
                <li key={moduloKey} className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setColapsados((p) => ({ ...p, [moduloKey]: !p[moduloKey] }))}
                    className="group/grp flex w-full items-center gap-2 text-left"
                  >
                    <span className={`inline-flex h-5 w-5 items-center justify-center rounded transition-colors ${colapsado ? "bg-slate-100" : "bg-[#0EA5E9]/10 text-[#0EA5E9]"}`}>
                      <svg className={`h-3 w-3 transition-transform ${colapsado ? "" : "rotate-90"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </span>
                    <span className="text-sm font-semibold text-slate-800 group-hover/grp:text-[#0B3A3D]">
                      {label}
                    </span>
                    <span className="text-[11px] text-slate-400">{evs.length} paso{evs.length === 1 ? "" : "s"}</span>
                    {failCount > 0 && (
                      <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 ring-1 ring-rose-200">
                        {failCount} error{failCount === 1 ? "" : "es"}
                      </span>
                    )}
                    {warnCount > 0 && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">
                        {warnCount} aviso{warnCount === 1 ? "" : "s"}
                      </span>
                    )}
                  </button>
                  {!colapsado && (
                    <ol className="mt-2 space-y-2 border-l-2 border-slate-100 pl-4">
                      {evs.map((e) => {
                        const h = humanizarEvento(e);
                        return (
                          <li key={e.id} className="group/row relative flex items-start gap-3">
                            <span className="absolute -left-[22px] top-1.5">
                              <EstadoDot estado={e.estado} />
                            </span>
                            <div className="min-w-0 flex-1 rounded-lg px-2 py-1.5 transition-colors group-hover/row:bg-slate-50">
                              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                <IconoFase tipo={h.icono} />
                                <p className="text-sm font-medium text-slate-800">{h.titulo}</p>
                                {e.submodulo && (
                                  <span className="text-[11px] text-slate-500">· {e.submodulo}</span>
                                )}
                                <span className="ml-auto tabular-nums text-[10px] text-slate-400">
                                  {new Date(e.ts).toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                                </span>
                              </div>
                              {h.descripcion && (
                                <p className="mt-0.5 break-words text-[12px] leading-snug text-slate-600">
                                  {h.descripcion}
                                </p>
                              )}
                              <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">
                                {etiquetaDeFase(e.fase)}
                              </p>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </li>
              );
            })}
          </ul>
          <div ref={bottomRef} />
        </div>
      )}
    </section>
  );
}

function EstadoDot({ estado }: { estado: string }) {
  const map: Record<string, { bg: string; ring: string; pulse: boolean }> = {
    ok:      { bg: "bg-emerald-500", ring: "ring-emerald-200", pulse: false },
    started: { bg: "bg-sky-500",     ring: "ring-sky-200",     pulse: true  },
    fail:    { bg: "bg-rose-500",    ring: "ring-rose-200",    pulse: false },
    warn:    { bg: "bg-amber-500",   ring: "ring-amber-200",   pulse: false },
    blocked: { bg: "bg-slate-400",   ring: "ring-slate-200",   pulse: false },
    skipped: { bg: "bg-slate-300",   ring: "ring-slate-100",   pulse: false },
  };
  const s = map[estado] ?? { bg: "bg-slate-200", ring: "ring-slate-100", pulse: false };
  return (
    <span className={`relative inline-flex h-3 w-3 items-center justify-center rounded-full ring-4 ${s.ring} bg-white`}>
      {s.pulse && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${s.bg} opacity-60`} />}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${s.bg}`} />
    </span>
  );
}

function IconoFase({ tipo }: { tipo: EventoHumano["icono"] }) {
  const base = "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-slate-500";
  const paths: Record<EventoHumano["icono"], React.ReactNode> = {
    login: (<><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>),
    nav:   (<><polyline points="9 18 15 12 9 6" /></>),
    click: (<><path d="M9 11V5a3 3 0 0 1 6 0v6" /><path d="M9 11v6a3 3 0 0 0 6 0v-6" /></>),
    input: (<><path d="M4 7h16" /><path d="M4 12h10" /><path d="M4 17h16" /></>),
    check: (<><polyline points="20 6 9 17 4 12" /></>),
    warn:  (<><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>),
    fail:  (<><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></>),
    ok:    (<><circle cx="12" cy="12" r="10" /><polyline points="16 10 11 15 8 12" /></>),
    info:  (<><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></>),
    wait:  (<><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>),
  };
  return (
    <span className={base} aria-hidden>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {paths[tipo]}
      </svg>
    </span>
  );
}
