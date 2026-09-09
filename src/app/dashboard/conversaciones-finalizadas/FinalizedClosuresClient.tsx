"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { X, MessageSquarePlus, Download, SlidersHorizontal } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import {
  listFinalizedClosures,
  type FinalizedClosureListRow,
  type FinalizedClosuresFilters,
  type FinalizedFilterOptions,
} from "@/lib/chat/finalized-closures-actions";
import { FechaSelect } from "@/components/ui/FechaSelect";
import { FancySelect } from "@/app/dashboard/proyectos/components/FancySelect";

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
/** Valor de "Todos" (tope del server para page_size). */
const TODOS_PAGE_SIZE = 1000;
const EXPORT_MAX_ROWS = 5000;

/**
 * Arrastrar el listado con el cursor, como se mueve un mapa.
 *
 * Se usa `pointer` y no `mouse` para que sirva igual con dedo o lápiz. Y sólo
 * se considera arrastre a partir de 4 px: sin ese umbral, un clic con un
 * temblor mínimo cancelaría la selección de texto de la celda.
 */
/** A qué distancia del borde empieza a correrse la tabla. */
const ZONA_BORDE = 90;
/** Píxeles por cuadro: en el borde exacto, y apenas entrando en la zona. */
const VELOCIDAD_MAX = 22;
const VELOCIDAD_MIN = 2;

function useBordesQueDesplazan() {
  const scrollRef = useRef<HTMLDivElement>(null);

  /** Velocidad actual del desplazamiento automático. 0 = quieto. */
  const velocidad = useRef(0);
  const cuadro = useRef<number | null>(null);
  /** Qué lado está activo, para pintar la señal en pantalla. */
  const [borde, setBorde] = useState<"izq" | "der" | null>(null);

  const detener = useCallback(() => {
    velocidad.current = 0;
    if (cuadro.current !== null) {
      cancelAnimationFrame(cuadro.current);
      cuadro.current = null;
    }
    setBorde(null);
  }, []);

  /**
   * El bucle corre mientras haya velocidad. No se reprograma solo: si el cursor
   * sale de la zona, `velocidad` queda en 0 y el bucle se apaga en el siguiente
   * cuadro. Así no queda nada girando de fondo.
   *
   * Es una función suelta y no un `useCallback` porque se llama a sí misma:
   * declarada como callback tendría que referenciarse antes de terminar de
   * existir. Sólo lee refs, así que no necesita reconstruirse en cada render.
   */
  function correr() {
    const el = scrollRef.current;
    if (!el || velocidad.current === 0) {
      cuadro.current = null;
      return;
    }
    const antes = el.scrollLeft;
    el.scrollLeft = antes + velocidad.current;
    // Si ya no se movió, se llegó al final: no tiene sentido seguir.
    if (el.scrollLeft === antes) {
      velocidad.current = 0;
      cuadro.current = null;
      // Se apaga la señal: si no se puede seguir, decir "hay más de este lado"
      // sería mentir.
      setBorde(null);
      return;
    }
    cuadro.current = requestAnimationFrame(correr);
  }

  /**
   * Acercar el cursor a un borde corre la tabla hacia ese lado.
   *
   * La velocidad crece cuanto más cerca del borde: al filo va rápido, y apenas
   * entrando en la zona se mueve despacio para poder frenar sobre la columna
   * que uno quiere leer. Una velocidad fija se pasa de largo siempre.
   */
  const evaluarBorde = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = scrollRef.current;
      if (!el) return;

      const caja = el.getBoundingClientRect();
      const desdeIzq = e.clientX - caja.left;
      const desdeDer = caja.right - e.clientX;
      const hayIzq = el.scrollLeft > 0;
      const hayDer = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;

      const rampa = (d: number) =>
        VELOCIDAD_MIN + (VELOCIDAD_MAX - VELOCIDAD_MIN) * (1 - d / ZONA_BORDE);

      let v = 0;
      let lado: "izq" | "der" | null = null;
      if (desdeIzq >= 0 && desdeIzq < ZONA_BORDE && hayIzq) {
        v = -rampa(desdeIzq);
        lado = "izq";
      } else if (desdeDer >= 0 && desdeDer < ZONA_BORDE && hayDer) {
        v = rampa(desdeDer);
        lado = "der";
      }

      velocidad.current = v;
      setBorde(lado);
      if (v !== 0 && cuadro.current === null) {
        cuadro.current = requestAnimationFrame(correr);
      }
    },
    // Sólo lee refs; no depende de nada que cambie entre renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Si el componente se va con el bucle andando, hay que cortarlo.
  useEffect(() => detener, [detener]);

  return { scrollRef, borde, alMover: evaluarBorde, alSalir: detener };
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeCsvCell(value: string): string {
  const s = String(value).replace(/"/g, '""');
  if (/[",\n\r]/.test(s)) return `"${s}"`;
  return s;
}

function buildCsv(rows: FinalizedClosureListRow[]): string {
  const headers = [
    "ID cierre",
    "ID conversación",
    "Fecha de finalización",
    "Contacto",
    "Número",
    "Canal (tipo)",
    "Canal (nombre)",
    "Cola",
    "Agente asignado",
    "Cerrado por",
    "Estado",
    "Subestado",
    "Comentario de cierre",
    "Último mensaje / resumen",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    const canalTipo = r.channel_type;
    const canalNombre = r.channel_nombre ?? "";
    lines.push(
      [
        escapeCsvCell(r.closure_id),
        escapeCsvCell(r.conversation_id),
        escapeCsvCell(formatDateTime(r.closed_at)),
        escapeCsvCell(r.contact_name ?? ""),
        escapeCsvCell(r.phone_number),
        escapeCsvCell(canalTipo),
        escapeCsvCell(canalNombre),
        escapeCsvCell(r.queue_nombre ?? ""),
        escapeCsvCell(r.assigned_agent_nombre ?? ""),
        escapeCsvCell(r.closed_by_nombre ?? ""),
        escapeCsvCell(r.state_label),
        escapeCsvCell(r.substate_label),
        escapeCsvCell(r.comment ?? ""),
        escapeCsvCell(r.last_preview ?? ""),
      ].join(",")
    );
  }
  return lines.join("\r\n");
}

type ChatMessageRow = {
  id: string;
  from_me: boolean;
  message_type: string;
  content: string | null;
  created_at: string;
};

export default function FinalizedClosuresClient({ filterOptions }: { filterOptions: FinalizedFilterOptions }) {
  const { scrollRef, borde, alMover, alSalir } = useBordesQueDesplazan();

  /**
   * Las opciones de cada filtro, con su "todos" adelante.
   *
   * Se arman una sola vez por lista: sin esto, cada tecla que se escribe en el
   * buscador reconstruiría cinco arreglos que no cambiaron.
   */
  const opcionesCola = useMemo(
    () => [
      { value: "", label: "Todas" },
      ...filterOptions.queues.map((x) => ({ value: x.id, label: x.nombre })),
    ],
    [filterOptions.queues]
  );
  const opcionesAgente = useMemo(
    () => [
      { value: "", label: "Todos" },
      ...filterOptions.agents.map((x) => ({ value: x.id, label: x.nombre })),
    ],
    [filterOptions.agents]
  );
  const opcionesCanal = useMemo(
    () => [
      { value: "", label: "Todos" },
      ...filterOptions.channels.map((c) => ({
        value: c.id,
        label: (c.nombre ?? c.type).trim() || c.type,
      })),
    ],
    [filterOptions.channels]
  );
  const opcionesEstado = useMemo(
    () => [
      { value: "", label: "Todos" },
      ...filterOptions.state_labels.map((x) => ({ value: x, label: x })),
    ],
    [filterOptions.state_labels]
  );
  const opcionesSubestado = useMemo(
    () => [
      { value: "", label: "Todos" },
      ...filterOptions.substate_labels.map((x) => ({ value: x, label: x })),
    ],
    [filterOptions.substate_labels]
  );
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [queueId, setQueueId] = useState("");
  const [assignedUsuarioId, setAssignedUsuarioId] = useState("");
  const [closedByUsuarioId, setClosedByUsuarioId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [stateLabel, setStateLabel] = useState("");
  const [substateLabel, setSubstateLabel] = useState("");
  const [q, setQ] = useState("");

  const [applied, setApplied] = useState<FinalizedClosuresFilters>({});

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [rows, setRows] = useState<FinalizedClosureListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [detail, setDetail] = useState<FinalizedClosureListRow | null>(null);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [msgError, setMsgError] = useState<string | null>(null);

  const filtersPayload = useMemo((): FinalizedClosuresFilters => {
    const f: FinalizedClosuresFilters = {};
    if (applied.date_from?.trim()) f.date_from = applied.date_from.trim();
    if (applied.date_to?.trim()) f.date_to = applied.date_to.trim();
    if (applied.queue_id?.trim()) f.queue_id = applied.queue_id.trim();
    if (applied.assigned_usuario_id?.trim()) f.assigned_usuario_id = applied.assigned_usuario_id.trim();
    if (applied.closed_by_usuario_id?.trim()) f.closed_by_usuario_id = applied.closed_by_usuario_id.trim();
    if (applied.channel_id?.trim()) f.channel_id = applied.channel_id.trim();
    if (applied.state_label?.trim()) f.state_label = applied.state_label.trim();
    if (applied.substate_label?.trim()) f.substate_label = applied.substate_label.trim();
    if (applied.q?.trim()) f.q = applied.q.trim();
    return f;
  }, [applied]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const res = await listFinalizedClosures(filtersPayload, page, pageSize);
      setRows(res.rows);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar");
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [filtersPayload, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  const applyFilters = () => {
    setInfo(null);
    setApplied({
      date_from: dateFrom || null,
      date_to: dateTo || null,
      queue_id: queueId || null,
      assigned_usuario_id: assignedUsuarioId || null,
      closed_by_usuario_id: closedByUsuarioId || null,
      channel_id: channelId || null,
      state_label: stateLabel || null,
      substate_label: substateLabel || null,
      q: q || null,
    });
    setPage(1);
  };

  const onExport = async () => {
    setError(null);
    setInfo(null);
    try {
      const res = await listFinalizedClosures(filtersPayload, 1, EXPORT_MAX_ROWS);
      const csv = buildCsv(res.rows);
      const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `conversaciones-finalizadas-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      if (res.total > res.rows.length) {
        setInfo(
          `Se exportaron ${res.rows.length} filas de ${res.total} (límite ${EXPORT_MAX_ROWS}). Ajustá filtros o fechas para acotar el conjunto.`
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al exportar");
    }
  };

  useEffect(() => {
    if (!detail) {
      setMessages([]);
      setMsgError(null);
      return;
    }
    const cid = detail.conversation_id;
    let cancelled = false;
    setMsgLoading(true);
    setMsgError(null);
    setMessages([]);
    void (async () => {
      try {
        const res = await fetchWithSupabaseSession(
          `/api/chat/messages?conversation_id=${encodeURIComponent(cid)}`,
          { cache: "no-store" }
        );
        const json = (await res.json()) as {
          success?: boolean;
          data?: ChatMessageRow[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !json.success) {
          setMsgError(json.error ?? "No se pudieron cargar los mensajes");
          return;
        }
        setMessages(Array.isArray(json.data) ? json.data : []);
      } catch {
        if (!cancelled) setMsgError("Error de red al cargar mensajes");
      } finally {
        if (!cancelled) setMsgLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detail]);

  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetail(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // Vista de ASESOR (alcance "own"): filtros reducidos (Fecha, Estado, búsqueda).
  const esAsesor = filterOptions.ux_scope === "own";

  const channelLabel = (r: FinalizedClosureListRow) =>
    r.channel_nombre?.trim() ? `${r.channel_nombre} (${r.channel_type})` : r.channel_type;

  return (
    <div className="flex flex-col gap-6 pb-12 px-4 md:px-6 max-w-[1400px] mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 pt-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Conversaciones finalizadas</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            {filterOptions.ux_scope === "own"
              ? "Tus conversaciones finalizadas. Filtrá por fecha, estado o buscá un contacto. Exportá el resultado para Excel."
              : filterOptions.ux_scope === "team"
                ? "Vista acotada a tu alcance omnicanal: los combos solo listan colas, agentes y canales relevantes para tu equipo. Exportá el resultado filtrado."
                : "Bandeja global de cierres: todas las colas, agentes y canales. Filtrá, revisá el detalle sin salir de la pantalla y exportá el resultado filtrado para Excel."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onExport()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl bg-[#4FAEB2] px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-[#4FAEB2]/25 transition-colors hover:bg-[#3F8E91] disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          Descargar Excel (CSV)
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}
      {info && !error && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">{info}</div>
      )}

      <section className="space-y-4 overflow-hidden rounded-2xl border border-[#4FAEB2]/20 bg-white shadow-[0_2px_12px_rgba(47,110,113,0.08)]">
        <div className="flex items-center gap-2 border-b border-[#4FAEB2]/15 bg-gradient-to-r from-[#4FAEB2]/12 via-[#4FAEB2]/5 to-transparent px-4 py-3 md:px-5">
          <SlidersHorizontal className="h-4 w-4 text-[#2F6E71]" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#2F6E71]">Filtros</h2>
        </div>
        <div className="px-4 pb-4 md:px-5 md:pb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#2F6E71]">
            Desde
            <FechaSelect
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 transition-colors focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20"
/>
          </label>
          <label className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#2F6E71]">
            Hasta
            <FechaSelect
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 transition-colors focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20"
/>
          </label>
          {!esAsesor && (
          <label className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#2F6E71]">
            Cola
            <FancySelect
              ariaLabel="Cola"
              value={queueId}
              onChange={setQueueId}
              placeholder="Todas"
              options={opcionesCola}
            />
          </label>
          )}
          {!esAsesor && (
          <label className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#2F6E71]">
            Agente asignado
            <FancySelect
              ariaLabel="Agente asignado"
              value={assignedUsuarioId}
              onChange={setAssignedUsuarioId}
              placeholder="Todos"
              options={opcionesAgente}
            />
          </label>
          )}
          {!esAsesor && (
          <label className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#2F6E71]">
            Canal
            <FancySelect
              ariaLabel="Canal"
              value={channelId}
              onChange={setChannelId}
              placeholder="Todos"
              options={opcionesCanal}
            />
          </label>
          )}
          <label className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#2F6E71]">
            Estado
            <FancySelect
              ariaLabel="Estado"
              value={stateLabel}
              onChange={setStateLabel}
              placeholder="Todos"
              options={opcionesEstado}
            />
          </label>
          {!esAsesor && (
          <label className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#2F6E71]">
            Subestado
            <FancySelect
              ariaLabel="Subestado"
              value={substateLabel}
              onChange={setSubstateLabel}
              placeholder="Todos"
              options={opcionesSubestado}
            />
          </label>
          )}
          <label className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#2F6E71] sm:col-span-2">
            Nombre o número
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar contacto…"
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 transition-colors focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20"
            />
          </label>
        </div>

        {/* Separado del último campo por una línea: pegado, "Aplicar filtros"
            se leía como parte del buscador de contacto. */}
        <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={applyFilters}
            className="rounded-xl bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-[#4FAEB2]/25 transition-colors hover:bg-[#3F8E91]"
          >
            Aplicar filtros
          </button>
          <button
            type="button"
            onClick={() => {
              setDateFrom("");
              setDateTo("");
              setQueueId("");
              setAssignedUsuarioId("");
              setClosedByUsuarioId("");
              setChannelId("");
              setStateLabel("");
              setSubstateLabel("");
              setQ("");
              setInfo(null);
              setError(null);
              setApplied({});
              setPage(1);
            }}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Limpiar
          </button>
        </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-[#4FAEB2]/20 bg-white shadow-[0_2px_12px_rgba(47,110,113,0.08)]">
        {/*
          Once columnas no entran en ninguna pantalla, y buscar la barra de
          abajo para leer el comentario de un cierre es un trabajo que la tabla
          te está haciendo hacer. Acercar el cursor a un borde la desplaza sola.
        */}
        <div className="relative">
          {/* La sombra dice hacia dónde se está yendo, y que hay más. */}
          {borde === "izq" ? (
            <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-[90px] bg-gradient-to-r from-[#4FAEB2]/25 to-transparent" />
          ) : null}
          {borde === "der" ? (
            <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-[90px] bg-gradient-to-l from-[#4FAEB2]/25 to-transparent" />
          ) : null}
        <div
          ref={scrollRef}
          onPointerMove={alMover}
          onPointerLeave={alSalir}
          className="overflow-x-auto"
        >
          <table className="w-full min-w-[1000px] text-left text-sm">
            <thead className="border-b border-[#4FAEB2]/20 bg-gradient-to-r from-[#4FAEB2]/12 via-[#4FAEB2]/6 to-transparent text-xs font-semibold uppercase tracking-wide text-[#2F6E71]">
              <tr>
                <th className="px-3 py-3 whitespace-nowrap">Finalización</th>
                <th className="px-3 py-3">Contacto</th>
                <th className="px-3 py-3 whitespace-nowrap">Número</th>
                <th className="px-3 py-3">Canal</th>
                <th className="px-3 py-3">Cola</th>
                <th className="px-3 py-3">Agente asignado</th>
                <th className="px-3 py-3">Cerrado por</th>
                <th className="px-3 py-3">Estado</th>
                <th className="px-3 py-3">Subestado</th>
                <th className="px-3 py-3 min-w-[140px]">Comentario</th>
                <th className="px-3 py-3 min-w-[160px]">Último mensaje</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={11} className="px-3 py-10 text-center text-slate-400">
                    Cargando…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-3 py-10 text-center text-slate-500">
                    No hay conversaciones finalizadas con estos filtros.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.closure_id}
                    onClick={() => setDetail(r)}
                    className="cursor-pointer hover:bg-slate-50/80 transition-colors"
                  >
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-700">{formatDateTime(r.closed_at)}</td>
                    <td className="px-3 py-2.5 text-slate-900 font-medium">{r.contact_name ?? "—"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">{r.phone_number}</td>
                    <td className="px-3 py-2.5 text-slate-700">{channelLabel(r)}</td>
                    <td className="px-3 py-2.5 text-slate-700">{r.queue_nombre ?? "—"}</td>
                    <td className="px-3 py-2.5 text-slate-700">{r.assigned_agent_nombre ?? "—"}</td>
                    <td className="px-3 py-2.5 text-slate-700">{r.closed_by_nombre ?? "—"}</td>
                    <td className="px-3 py-2.5 text-slate-700">{r.state_label}</td>
                    <td className="px-3 py-2.5 text-slate-700">{r.substate_label}</td>
                    <td className="px-3 py-2.5 text-slate-600 max-w-[200px] truncate" title={r.comment}>
                      {r.comment || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 max-w-[220px] truncate" title={r.last_preview ?? ""}>
                      {r.last_preview ?? "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        </div>
        {!loading && total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
            <div className="flex items-center gap-3">
              <span>
                {total === 0 ? "0" : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)}`} de {total}
              </span>
              <label className="flex items-center gap-1.5 text-xs text-slate-500">
                Filas
                <select
                  value={pageSize >= TODOS_PAGE_SIZE ? "todos" : String(pageSize)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPageSize(v === "todos" ? TODOS_PAGE_SIZE : Number(v));
                    setPage(1);
                  }}
                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-900 bg-white"
                >
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={String(n)}>
                      {n}
                    </option>
                  ))}
                  <option value="todos">Todos</option>
                </select>
              </label>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-slate-200 px-3 py-1.5 font-medium disabled:opacity-40 hover:bg-slate-50"
              >
                Anterior
              </button>
              <span className="self-center text-slate-500">
                Página {page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 font-medium disabled:opacity-40 hover:bg-slate-50"
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </section>

      {detail && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-labelledby="finalized-detail-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDetail(null);
          }}
        >
          <div
            className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#4FAEB2]/25 bg-white shadow-2xl shadow-[#2F6E71]/15"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#4FAEB2]/20 bg-gradient-to-r from-[#4FAEB2]/14 via-[#4FAEB2]/6 to-transparent px-5 py-4">
              <div className="min-w-0">
                <h2 id="finalized-detail-title" className="text-[17px] font-semibold text-slate-900">
                  {detail.contact_name?.trim() || detail.phone_number || "Detalle del cierre"}
                </h2>
                {/* El teléfono y la fecha son lo que ubica: el id de la
                    conversación no le dice nada a nadie y ocupaba el renglón
                    más visible del modal. */}
                <p className="mt-0.5 truncate text-[12.5px] text-slate-600">
                  {detail.phone_number} · cerrado el {formatDateTime(detail.closed_at)}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Link
                  href={`/dashboard/conversaciones?buscar=${encodeURIComponent(detail.phone_number ?? "")}&cerradas=1`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-sm font-semibold text-white shadow-sm shadow-[#4FAEB2]/20 transition-colors hover:bg-[#3F8E91]"
                  title="Ir al chat para escribir a este cliente (mensaje normal o plantilla)"
                >
                  <MessageSquarePlus className="h-4 w-4" />
                  Nuevo mensaje
                </Link>
                <button
                  type="button"
                  onClick={() => setDetail(null)}
                  className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/70 hover:text-slate-700"
                  aria-label="Cerrar"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto bg-slate-50/50 px-5 py-4 text-sm">
              {/*
                Cómo terminó, arriba y solo. Es el dato por el que se abre este
                modal; mezclado entre otros ocho campos había que buscarlo.
              */}
              <div className="rounded-2xl border border-[#4FAEB2]/25 bg-white p-4 shadow-[0_1px_3px_rgba(47,110,113,0.08)]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-[#4FAEB2]/15 px-3 py-1 text-[13px] font-semibold text-[#2F6E71]">
                    {detail.state_label || "Sin estado"}
                  </span>
                  {detail.substate_label ? (
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-[12.5px] text-slate-600">
                      {detail.substate_label}
                    </span>
                  ) : null}
                </div>
                <p className="mt-3 whitespace-pre-wrap text-[13.5px] leading-relaxed text-slate-700">
                  {detail.comment?.trim() || (
                    <span className="italic text-slate-400">Sin comentario de cierre.</span>
                  )}
                </p>
              </div>

              {/* Quién y por dónde. Dos columnas fijas: la etiqueta a la
                  izquierda y el dato a la derecha se recorren de un vistazo,
                  cosa que una grilla de tarjetas sueltas no permite. */}
              <dl className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                {(
                  [
                    ["Agente asignado", detail.assigned_agent_nombre ?? "—"],
                    ["Cerrado por", detail.closed_by_nombre ?? "—"],
                    ["Cola", detail.queue_nombre ?? "—"],
                    ["Canal", channelLabel(detail)],
                  ] as const
                ).map(([rotulo, valor]) => (
                  <div
                    key={rotulo}
                    className="flex items-baseline gap-3 border-b border-slate-100 px-4 py-2.5 last:border-0"
                  >
                    <dt className="w-36 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-[#2F6E71]">
                      {rotulo}
                    </dt>
                    <dd className="min-w-0 flex-1 text-[13.5px] text-slate-800">{valor}</dd>
                  </div>
                ))}
              </dl>

              <div>
                <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#2F6E71]">
                  Mensajes
                </h3>
                {msgLoading ? (
                  <p className="text-slate-400 text-sm">Cargando historial…</p>
                ) : msgError ? (
                  <p className="text-red-600 text-sm">{msgError}</p>
                ) : messages.length === 0 ? (
                  <p className="text-slate-500 text-sm">No hay mensajes en esta conversación.</p>
                ) : (
                  <ul className="max-h-[min(50vh,420px)] space-y-2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3">
                    {messages.map((m) => (
                      <li
                        key={m.id}
                        className={`w-fit max-w-[85%] rounded-xl px-3 py-2 text-sm shadow-[0_1px_2px_rgba(15,23,42,0.06)] ${
                          m.from_me
                            ? "ml-auto bg-[#E3F3E5] text-slate-800"
                            : "mr-auto border border-slate-200 bg-white text-slate-800"
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 mb-1">
                          <span>{formatDateTime(m.created_at)}</span>
                          <span className="rounded bg-slate-200/80 px-1.5 py-0.5 text-slate-700">{m.message_type}</span>
                          <span>{m.from_me ? "Saliente" : "Entrante"}</span>
                        </div>
                        <p className="whitespace-pre-wrap break-words">{m.content ?? "—"}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="border-t border-slate-100 px-5 py-3 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
