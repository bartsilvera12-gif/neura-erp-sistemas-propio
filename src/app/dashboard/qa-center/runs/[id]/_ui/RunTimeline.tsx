"use client";

/**
 * Timeline en vivo del agente QA.
 *
 * Hace polling a `/api/qa/runs/<id>/events?since=<last_ts>` cada 2s mientras
 * el run está `running` o `queued`. Cuando pasa a estado final, mantiene una
 * pasada más y se detiene.
 *
 * Diseño:
 *  - Agrupa por módulo (los eventos sin módulo van al grupo "general").
 *  - Dentro del módulo, timeline cronológico mostrando fase/acción/estado.
 *  - Auto-scroll al final cuando se agrega un evento nuevo.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
const TERMINAL_STATES = new Set(["passed", "failed", "aborted"]);

type Props = {
  runId: string;
  initialStatus: string;
};

export default function RunTimeline({ runId, initialStatus }: Props) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [status, setStatus] = useState<string>(initialStatus);
  const [err, setErr] = useState<string | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const lastTsRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const fetchOnce = useCallback(async (): Promise<boolean> => {
    try {
      const url = new URL(`/api/qa/runs/${runId}/events`, window.location.origin);
      if (lastTsRef.current) url.searchParams.set("since", lastTsRef.current);
      url.searchParams.set("limit", "200");
      const res = await fetch(url.pathname + url.search, { cache: "no-store" });
      const text = await res.text();
      let body: ApiResponse = { data: [], run_status: status, last_ts: null };
      try { body = text ? (JSON.parse(text) as ApiResponse) : body; } catch { /* ignore */ }
      if (!res.ok) {
        setErr(`HTTP ${res.status}`);
        return false;
      }
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

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [fetchOnce, status]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [events.length]);

  const agrupados = useMemo(() => {
    const map = new Map<string, RunEvent[]>();
    for (const e of events) {
      const k = e.modulo ?? "__general__";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    }
    return Array.from(map.entries());
  }, [events]);

  return (
    <section className="mb-6" data-testid="run-timeline">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-base font-semibold">Progreso en vivo</h2>
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <span data-testid="timeline-count">{events.length} eventos</span>
          {!TERMINAL_STATES.has(status) && (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              siguiendo
            </span>
          )}
          {err && <span className="text-rose-600">· {err}</span>}
        </div>
      </div>

      {events.length === 0 ? (
        <div className="rounded border border-dashed bg-slate-50 px-4 py-6 text-center text-xs text-slate-500">
          Esperando primer evento del agente…
        </div>
      ) : (
        <div className="max-h-[480px] overflow-y-auto rounded-lg border bg-white">
          <ul className="divide-y">
            {agrupados.map(([modulo, evs]) => (
              <li key={modulo} className="px-3 py-2">
                <p className="mb-1 font-mono text-[11px] font-medium text-slate-700">
                  {modulo === "__general__" ? "general" : modulo}
                  <span className="ml-2 text-[10px] text-slate-400">{evs.length} eventos</span>
                </p>
                <ol className="space-y-1 pl-3">
                  {evs.map((e) => (
                    <li key={e.id} className="flex items-start gap-2 text-[11px]">
                      <EstadoDot estado={e.estado} />
                      <span className="shrink-0 font-mono text-slate-400">
                        {new Date(e.ts).toLocaleTimeString()}
                      </span>
                      <span className="shrink-0 rounded bg-slate-100 px-1 font-mono text-[10px] text-slate-600">
                        {e.fase}
                      </span>
                      {e.submodulo && (
                        <span className="shrink-0 font-mono text-[10px] text-slate-500">{e.submodulo}</span>
                      )}
                      <span className="flex-1 text-slate-700">
                        {e.accion && <span className="font-semibold">{e.accion}:</span>}{" "}
                        {e.mensaje ?? ""}
                      </span>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
          <div ref={bottomRef} />
        </div>
      )}
    </section>
  );
}

function EstadoDot({ estado }: { estado: string }) {
  const color =
    estado === "ok"      ? "bg-emerald-500"
  : estado === "started" ? "bg-sky-500 animate-pulse"
  : estado === "fail"    ? "bg-rose-500"
  : estado === "warn"    ? "bg-amber-500"
  : estado === "blocked" ? "bg-slate-400"
  : estado === "skipped" ? "bg-slate-300"
  : "bg-slate-200";
  return <span className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${color}`} />;
}
