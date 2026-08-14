"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { FancySelect } from "@/app/dashboard/proyectos/components/FancySelect";
import {
  PROYECTO_ETAPAS,
  etapaColor,
  etapaLabel,
  type ProyectoEtapaDesarrollo,
} from "@/lib/proyectos/etapas-desarrollo";
import {
  QA_ETAPAS,
  qaEtapaColor,
  qaEtapaLabel,
  type ProyectoEtapaQA,
} from "@/lib/proyectos/etapas-qa";

type ActivoItem = {
  id: string;
  titulo: string;
  cliente: string;
  tipo: string;
  prioridad: string;
  etapa_desarrollo: ProyectoEtapaDesarrollo;
  dias: number | null;
  dias_en_etapa: number | null;
  desde: string | null;
  fecha_prometida: string | null;
  bloqueado: boolean;
  pausado: boolean;
  pausa_motivo: string | null;
  pausado_at: string | null;
  qa_responsable_id: string | null;
  qa_responsable_nombre: string | null;
  qa_etapa: ProyectoEtapaQA | null;
};

type GrupoActivo = {
  tecnico_id: string | null;
  tecnico_nombre: string;
  cantidad: number;
  pausados: number;
  proyectos: ActivoItem[];
};

type QAItem = {
  id: string;
  titulo: string;
  cliente: string;
  tipo: string;
  qa_etapa: ProyectoEtapaQA;
  etapa_desarrollo: ProyectoEtapaDesarrollo;
  dias: number | null;
  desde: string | null;
  fecha_prometida: string | null;
  pausado: boolean;
  pausa_motivo: string | null;
  tecnico_nombre: string | null;
};

type GrupoQA = {
  qa_id: string;
  qa_nombre: string;
  cantidad: number;
  proyectos: QAItem[];
};

type FinalizadoItem = {
  id: string;
  titulo: string;
  cliente: string;
  tipo: string;
  finalizado_at: string;
  dias_tardados: number | null;
};

type GrupoFinalizado = {
  tecnico_id: string | null;
  tecnico_nombre: string;
  cantidad: number;
  promedio_dias: number | null;
  proyectos: FinalizadoItem[];
};

type TareasEquipoData = {
  mes: string;
  desde: string;
  hasta: string;
  activos_total: number;
  activos_por_programador: GrupoActivo[];
  qa_total: number;
  qa_por_responsable: GrupoQA[];
  finalizados_total: number;
  finalizados_por_programador: GrupoFinalizado[];
};

/**
 * `es_qa` marca a la gente de QA. No es un rol de permisos: sólo decide qué
 * vocabulario de etapas usa su tarjeta en este tablero.
 */
type Usuario = { id: string; nombre?: string | null; es_qa?: boolean };

type ApiResponse = { success: boolean; data?: TareasEquipoData; error?: string };

/** Valor centinela del selector de etapa: no es una etapa, abre el editor de pausa. */
const OPCION_PAUSA = "__pausa__";

/** Paleta estable por nombre: el mismo programador conserva su color entre cargas. */
const AVATAR_PALETTE = [
  { bg: "#4FAEB2", soft: "rgba(79,174,178,0.10)" },
  { bg: "#8b5cf6", soft: "rgba(139,92,246,0.10)" },
  { bg: "#f59e0b", soft: "rgba(245,158,11,0.10)" },
  { bg: "#059669", soft: "rgba(5,150,105,0.10)" },
  { bg: "#f43f5e", soft: "rgba(244,63,94,0.10)" },
  { bg: "#0284c7", soft: "rgba(2,132,199,0.10)" },
  { bg: "#6366f1", soft: "rgba(99,102,241,0.10)" },
  { bg: "#d946ef", soft: "rgba(217,70,239,0.10)" },
];

function paleta(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

function initials(name: string) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/** Nombres del catálogo vienen en mayúsculas y largos: acortamos para el listado. */
function nombreCorto(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return name;
  const bonito = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return parts.length === 1 ? bonito(parts[0]) : `${bonito(parts[0])} ${bonito(parts[1])}`;
}

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(ym: string, delta: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return currentYearMonth();
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatMesLargo(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return ym;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  const fmt = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric", timeZone: "UTC" });
  const s = fmt.format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** dd/MM/yy — el encabezado del mensaje de WhatsApp usa este formato. */
function formatFechaCorta(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

function formatFecha(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** dd/MM — fechas cortas dentro de la fila (inicio de pausa, etc.). */
function formatDiaMes(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** ISO -> yyyy-MM-dd en hora local, para prellenar un <input type="date">. */
function isoADateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** dd/MM HH:mm — la fecha/hora de entrega dentro del mensaje. */
function formatEntrega(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return hh === "00" && mi === "00" ? `${dd}/${mm}` : `${dd}/${mm} ${hh}:${mi}`;
}

function etiquetaProyecto(p: { cliente: string; tipo: string }): string {
  const tipo = p.tipo.trim();
  return tipo ? `${p.cliente} (${tipo})` : p.cliente;
}

/** El título sólo aporta si dice algo distinto al nombre del cliente. */
function subtituloUtil(p: { cliente: string; titulo: string }): string | null {
  const norm = (s: string) => s.trim().toLowerCase();
  return norm(p.titulo) && norm(p.titulo) !== norm(p.cliente) ? p.titulo : null;
}

/**
 * Arma el mensaje con el formato que el equipo ya usa en WhatsApp: un bloque por
 * responsable con sus clientes, etapa y días. Los proyectos pausados llevan el
 * motivo en la misma línea — es la información que el resto del equipo pregunta.
 * QA va al final, con sus propias etapas.
 */
function buildMensajeWhatsapp(grupos: GrupoActivo[], qaGrupos: GrupoQA[]): string {
  const lineas: string[] = ["*Tareas del equipo*", `*${formatFechaCorta(new Date())}*`, ""];

  for (const g of grupos) {
    if (g.proyectos.length === 0) continue;

    lineas.push("*Cliente:*");
    for (const p of g.proyectos) {
      const dias = p.dias == null ? "" : ` · ${p.dias}d`;
      const pausa = p.pausado
        ? ` · ⏸ PAUSADO${p.pausa_motivo ? `: ${p.pausa_motivo}` : ""}`
        : "";
      lineas.push(`•${etiquetaProyecto(p)} — ${etapaLabel(p.etapa_desarrollo)}${pausa}${dias}`);
    }

    lineas.push("*Responsable:*");
    lineas.push(`•${nombreCorto(g.tecnico_nombre)}`);

    lineas.push("*Fecha/hora de entrega:*");
    for (const p of g.proyectos) {
      const entrega = formatEntrega(p.fecha_prometida);
      if (entrega) lineas.push(`•${p.cliente}: ${entrega}`);
    }

    lineas.push("");
  }

  for (const g of qaGrupos) {
    if (g.proyectos.length === 0) continue;

    lineas.push("*QA — Cliente:*");
    for (const p of g.proyectos) {
      const dias = p.dias == null ? "" : ` · ${p.dias}d`;
      const pausa = p.pausado
        ? ` · ⏸ PAUSADO${p.pausa_motivo ? `: ${p.pausa_motivo}` : ""}`
        : "";
      lineas.push(`•${etiquetaProyecto(p)} — ${qaEtapaLabel(p.qa_etapa)}${pausa}${dias}`);
    }

    lineas.push("*Responsable:*");
    lineas.push(`•${nombreCorto(g.qa_nombre)}`);

    lineas.push("*Fecha/hora de entrega:*");
    for (const p of g.proyectos) {
      const entrega = formatEntrega(p.fecha_prometida);
      if (entrega) lineas.push(`•${p.cliente}: ${entrega}`);
    }

    lineas.push("");
  }

  return lineas.join("\n").trimEnd();
}

export default function TareasEquipoClient() {
  const [mes, setMes] = useState<string>(() => currentYearMonth());
  const [data, setData] = useState<TareasEquipoData | null>(null);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [verFinalizados, setVerFinalizados] = useState(false);

  const load = useCallback(async (target: string) => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetchWithSupabaseSession(
        `/api/proyectos/tareas-equipo?mes=${encodeURIComponent(target)}`,
        { cache: "no-store" }
      );
      const j = (await res.json().catch(() => null)) as ApiResponse | null;
      if (!res.ok || !j?.success || !j.data) {
        setErr(j?.error ?? "No se pudo cargar el tablero del equipo");
        setData(null);
      } else {
        setData(j.data);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de red");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(mes);
  }, [load, mes]);

  useEffect(() => {
    let cancelado = false;
    void (async () => {
      try {
        const res = await fetchWithSupabaseSession("/api/usuarios/empresa-activos", { cache: "no-store" });
        const j = (await res.json().catch(() => null)) as { usuarios?: Usuario[] } | null;
        if (!cancelado) setUsuarios(j?.usuarios ?? []);
      } catch {
        // Sin la lista el tablero sigue sirviendo: se pierde reasignar, nada más.
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  /** Único punto de escritura: todas las ediciones de la fila pasan por acá. */
  const patchProyecto = useCallback(
    async (proyectoId: string, cambios: Record<string, unknown>) => {
      setSavingId(proyectoId);
      setErr(null);
      try {
        const res = await fetchWithSupabaseSession(`/api/proyectos/${proyectoId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cambios),
        });
        const j = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
        if (!res.ok || !j?.success) {
          setErr(j?.error ?? "No se pudo guardar el cambio");
          return;
        }
        // Cualquiera de estos cambios reordena o mueve la tarjeta de grupo, y
        // pasar a Finalizado la saca del listado: recargamos los dos bloques.
        await load(mes);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Error de red");
      } finally {
        setSavingId(null);
      }
    },
    [load, mes]
  );

  const mensaje = useMemo(
    () => buildMensajeWhatsapp(data?.activos_por_programador ?? [], data?.qa_por_responsable ?? []),
    [data]
  );

  const copiar = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(mensaje);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      setErr("El navegador bloqueó el portapapeles. Copiá el texto de la vista previa a mano.");
    }
  }, [mensaje]);

  const pausadosTotal = useMemo(
    () => (data?.activos_por_programador ?? []).reduce((acc, g) => acc + g.pausados, 0),
    [data]
  );

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 shrink-0 rounded-full bg-[#4FAEB2] shadow-[0_0_0_3px_rgba(79,174,178,0.18)]"
            />
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#4FAEB2]">Equipo</p>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Tareas del equipo</h1>
          <p className="text-sm text-slate-500">
            Proyectos por programador y por QA, con etapa y días desde que se asignó.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void copiar()}
            disabled={!mensaje}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#4FAEB2] px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-[#3F8E91] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            title="Copiar el pase del día con el formato de WhatsApp"
          >
            {copiado ? <IconCheck /> : <IconCopy />}
            {copiado ? "¡Copiado!" : "Copiar para WhatsApp"}
          </button>
          <Link
            href="/dashboard/proyectos"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm transition-colors hover:border-[#4FAEB2]/60 hover:text-[#4FAEB2]"
          >
            <IconChevronLeft />
            Volver al tablero
          </Link>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        <div className="flex items-center gap-0.5 rounded-xl border border-slate-200 bg-slate-100/80 p-0.5">
          <button
            type="button"
            onClick={() => setVerFinalizados(false)}
            aria-pressed={!verFinalizados}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              !verFinalizados ? "bg-white text-[#3F8E91] shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            En curso ({data?.activos_total ?? 0})
          </button>
          <button
            type="button"
            onClick={() => setVerFinalizados(true)}
            aria-pressed={verFinalizados}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              verFinalizados ? "bg-white text-[#3F8E91] shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Finalizados ({data?.finalizados_total ?? 0})
          </button>
        </div>

        {!verFinalizados && (data?.qa_total ?? 0) > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700">
            <IconShield />
            {data?.qa_total} en QA
          </span>
        ) : null}

        {!verFinalizados && pausadosTotal > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
            <IconPause />
            {pausadosTotal} {pausadosTotal === 1 ? "pausado" : "pausados"}
          </span>
        ) : null}

        {verFinalizados ? (
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => setMes((m) => shiftMonth(m, -1))}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:border-[#4FAEB2]/60 hover:text-[#4FAEB2]"
              aria-label="Mes anterior"
            >
              <IconChevronLeft />
            </button>
            <input
              type="month"
              value={mes}
              onChange={(e) => setMes(e.target.value || currentYearMonth())}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
              aria-label="Mes a consultar"
            />
            <button
              type="button"
              onClick={() => setMes((m) => shiftMonth(m, 1))}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:border-[#4FAEB2]/60 hover:text-[#4FAEB2]"
              aria-label="Mes siguiente"
            >
              <IconChevronRight />
            </button>
            <span className="ml-2 hidden text-sm text-slate-500 sm:inline">{formatMesLargo(mes)}</span>
          </div>
        ) : (
          <div className="ml-auto flex items-center gap-3 pr-1 text-[11px] text-slate-400">
            <LeyendaDias />
          </div>
        )}
      </div>

      {err ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{err}</div>
      ) : null}

      {loading && !data ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          Cargando tablero…
        </div>
      ) : verFinalizados ? (
        <FinalizadosSeccion data={data} mes={mes} />
      ) : (
        <>
          <ActivosSeccion
            grupos={data?.activos_por_programador ?? []}
            qaGrupos={data?.qa_por_responsable ?? []}
            usuarios={usuarios}
            savingId={savingId}
            onPatch={patchProyecto}
          />
          {mensaje ? (
            <details className="group rounded-2xl border border-slate-200 bg-white shadow-sm">
              <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-3 text-xs font-semibold text-slate-600 transition-colors hover:text-[#3F8E91]">
                <span className="transition-transform group-open:rotate-90">
                  <IconChevronRight />
                </span>
                Vista previa del mensaje de WhatsApp
              </summary>
              <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap border-t border-slate-100 bg-slate-50/60 px-4 py-3 font-mono text-[12px] leading-relaxed text-slate-700">
                {mensaje}
              </pre>
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}

function LeyendaDias() {
  return (
    <div className="flex items-center gap-2">
      <span className="hidden sm:inline">Días trabajados:</span>
      <span className="inline-flex items-center gap-1">
        <i className="h-2 w-2 rounded-full bg-slate-300" aria-hidden="true" />
        &lt;14
      </span>
      <span className="inline-flex items-center gap-1">
        <i className="h-2 w-2 rounded-full bg-amber-400" aria-hidden="true" />
        14+
      </span>
      <span className="inline-flex items-center gap-1">
        <i className="h-2 w-2 rounded-full bg-rose-400" aria-hidden="true" />
        30+
      </span>
    </div>
  );
}

/**
 * Tarjeta de un responsable. `overflow` queda visible a propósito: los
 * `FancySelect` de las filas despliegan un popover absoluto que un
 * `overflow-hidden` en la tarjeta recortaría.
 */
function TarjetaGrupo({
  color,
  inicial,
  titulo,
  subtitulo,
  contador,
  badge,
  italic,
  children,
}: {
  color: { bg: string; soft: string };
  inicial: string;
  titulo: string;
  subtitulo: string;
  contador: number;
  badge?: React.ReactNode;
  italic?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-shadow hover:shadow-[0_8px_24px_-12px_rgba(15,23,42,0.15)]">
      <header
        className="flex items-center gap-3 rounded-t-2xl border-b border-slate-100 px-4 py-3"
        style={{ backgroundColor: color.soft }}
      >
        <span
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ring-2 ring-white"
          style={{ backgroundColor: color.bg }}
          aria-hidden="true"
        >
          {inicial}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`truncate text-sm font-semibold ${italic ? "italic text-slate-500" : "text-slate-900"}`}
              title={titulo}
            >
              {titulo}
            </span>
            {badge}
          </div>
          <div className="text-[11px] text-slate-500">{subtitulo}</div>
        </div>
        <span
          className="shrink-0 rounded-full px-2.5 py-1 text-[13px] font-bold tabular-nums text-white"
          style={{ backgroundColor: color.bg }}
        >
          {contador}
        </span>
      </header>
      {children}
    </section>
  );
}

function ActivosSeccion({
  grupos,
  qaGrupos,
  usuarios,
  savingId,
  onPatch,
}: {
  grupos: GrupoActivo[];
  qaGrupos: GrupoQA[];
  usuarios: Usuario[];
  savingId: string | null;
  onPatch: (id: string, cambios: Record<string, unknown>) => void | Promise<void>;
}) {
  // Las tarjetas de QA existen aunque no tengan proyectos, así que el vacío se
  // mide por proyectos y no por tarjetas: si no, este estado nunca se veria.
  const totalProyectos =
    grupos.reduce((n, g) => n + g.proyectos.length, 0) +
    qaGrupos.reduce((n, g) => n + g.proyectos.length, 0);

  if (totalProyectos === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
        <p className="text-sm font-medium text-slate-700">No hay proyectos en curso</p>
        <p className="mt-1 text-xs text-slate-500">
          Todos los proyectos activos están en etapa “Finalizado” o no hay proyectos cargados.
        </p>
      </div>
    );
  }

  // Dos listas separadas a propósito: el selector de una tarjeta de programador
  // elige quién desarrolla, y el de una tarjeta de QA elige quién revisa.
  // Mezclarlas dejaba elegir a la QA como programadora, que no es lo que nadie
  // quiere decir cuando la busca en esa lista.
  const opcionesDev = [
    { value: "", label: "Sin asignar" },
    ...usuarios.filter((u) => !u.es_qa).map((u) => ({ value: u.id, label: nombreCorto(u.nombre ?? "") })),
  ];
  const opcionesQA = [
    { value: "", label: "Quitar de QA" },
    ...usuarios.filter((u) => u.es_qa).map((u) => ({ value: u.id, label: nombreCorto(u.nombre ?? "") })),
  ];

  // Programadores y QA conviven en la misma grilla, ordenados por nombre: para
  // el equipo, QA es una integrante más y no una sección aparte.
  type Tarjeta =
    | { kind: "dev"; key: string; orden: string; grupo: GrupoActivo }
    | { kind: "qa"; key: string; orden: string; grupo: GrupoQA };

  const tarjetas: Tarjeta[] = [
    ...grupos.map(
      (g): Tarjeta => ({
        kind: "dev",
        key: `dev:${g.tecnico_id ?? "__SIN__"}`,
        // "Sin asignar" siempre al final, sin importar el alfabeto.
        orden: g.tecnico_id == null ? "￿" : g.tecnico_nombre,
        grupo: g,
      })
    ),
    ...qaGrupos.map(
      (g): Tarjeta => ({ kind: "qa", key: `qa:${g.qa_id}`, orden: g.qa_nombre, grupo: g })
    ),
  ].sort((a, b) => a.orden.localeCompare(b.orden));

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {tarjetas.map((t) => {
        if (t.kind === "qa") {
          const g = t.grupo;
          return (
            <TarjetaGrupo
              key={t.key}
              color={{ bg: "#6366f1", soft: "rgba(99,102,241,0.08)" }}
              inicial={initials(g.qa_nombre)}
              titulo={nombreCorto(g.qa_nombre)}
              subtitulo={
                g.cantidad === 1 ? "1 proyecto en revisión" : `${g.cantidad} proyectos en revisión`
              }
              contador={g.cantidad}
              badge={
                <span className="shrink-0 rounded-md bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700">
                  QA
                </span>
              }
            >
              {g.proyectos.length === 0 ? (
                <p className="px-4 py-6 text-center text-[11px] leading-relaxed text-slate-400">
                  Sin proyectos en revisión.
                  <br />
                  Para mandarle uno, elegila en el selector de responsable del proyecto.
                </p>
              ) : null}
              <ul className="divide-y divide-slate-100">
                {g.proyectos.map((p) => (
                  <FilaProyecto
                    key={p.id}
                    modo="qa"
                    id={p.id}
                    cliente={p.cliente}
                    tipo={p.tipo}
                    titulo={p.titulo}
                    etapa={p.qa_etapa}
                    color={qaEtapaColor(p.qa_etapa)}
                    opcionesEtapa={QA_ETAPAS.map((e) => ({
                      value: e.codigo as string,
                      label: e.label,
                    }))}
                    dias={p.dias}
                    diasEnEtapa={null}
                    asignadoA={g.qa_id}
                    fechaPrometida={p.fecha_prometida}
                    metaExtra={p.tecnico_nombre ? `dev ${nombreCorto(p.tecnico_nombre)}` : null}
                    pausado={p.pausado}
                    pausaMotivo={p.pausa_motivo}
                    pausadoAt={null}
                    bloqueado={false}
                    qaChip={null}
                    desde={p.desde}
                    opcionesUsuario={opcionesQA}
                    saving={savingId === p.id}
                    onPatch={onPatch}
                  />
                ))}
              </ul>
            </TarjetaGrupo>
          );
        }

        const g = t.grupo;
        const sinTecnico = g.tecnico_id == null;
        const col = sinTecnico
          ? { bg: "#94a3b8", soft: "rgba(148,163,184,0.10)" }
          : paleta(g.tecnico_nombre);
        return (
          <TarjetaGrupo
            key={t.key}
            color={col}
            inicial={sinTecnico ? "—" : initials(g.tecnico_nombre)}
            titulo={sinTecnico ? "Sin asignar" : nombreCorto(g.tecnico_nombre)}
            italic={sinTecnico}
            subtitulo={`${g.cantidad === 1 ? "1 proyecto" : `${g.cantidad} proyectos`}${
              g.pausados > 0 ? ` · ${g.pausados} en pausa` : ""
            }`}
            contador={g.cantidad}
          >
            <ul className="divide-y divide-slate-100">
              {g.proyectos.map((p) => (
                <FilaProyecto
                  key={p.id}
                  modo="dev"
                  id={p.id}
                  cliente={p.cliente}
                  tipo={p.tipo}
                  titulo={p.titulo}
                  etapa={p.pausado ? OPCION_PAUSA : p.etapa_desarrollo}
                  color={p.pausado ? "#f59e0b" : etapaColor(p.etapa_desarrollo)}
                  opcionesEtapa={[
                    ...PROYECTO_ETAPAS.map((e) => ({ value: e.codigo as string, label: e.label })),
                    { value: OPCION_PAUSA, label: "Pausado…" },
                  ]}
                  dias={p.dias}
                  diasEnEtapa={p.dias_en_etapa}
                  asignadoA={g.tecnico_id}
                  fechaPrometida={p.fecha_prometida}
                  metaExtra={null}
                  pausado={p.pausado}
                  pausaMotivo={p.pausa_motivo}
                  pausadoAt={p.pausado_at}
                  bloqueado={p.bloqueado}
                  qaChip={
                    p.qa_responsable_nombre
                      ? { nombre: p.qa_responsable_nombre, etapa: p.qa_etapa }
                      : null
                  }
                  desde={p.desde}
                  opcionesUsuario={opcionesDev}
                  saving={savingId === p.id}
                  onPatch={onPatch}
                />
              ))}
            </ul>
          </TarjetaGrupo>
        );
      })}
    </div>
  );
}

/**
 * Fila de proyecto, la misma para programadores y para QA. Lo único que cambia
 * es el vocabulario de etapas y a qué campo escribe el selector de responsable.
 */
function FilaProyecto({
  modo,
  id,
  cliente,
  tipo,
  titulo,
  etapa,
  color,
  opcionesEtapa,
  dias,
  diasEnEtapa,
  asignadoA,
  fechaPrometida,
  metaExtra,
  pausado,
  pausaMotivo,
  pausadoAt,
  bloqueado,
  qaChip,
  desde,
  opcionesUsuario,
  saving,
  onPatch,
}: {
  modo: "dev" | "qa";
  id: string;
  cliente: string;
  tipo: string;
  titulo: string;
  etapa: string;
  color: string;
  opcionesEtapa: { value: string; label: string }[];
  dias: number | null;
  diasEnEtapa: number | null;
  asignadoA: string | null;
  fechaPrometida: string | null;
  metaExtra: string | null;
  pausado: boolean;
  pausaMotivo: string | null;
  pausadoAt: string | null;
  bloqueado: boolean;
  qaChip: { nombre: string; etapa: ProyectoEtapaQA | null } | null;
  desde: string | null;
  opcionesUsuario: { value: string; label: string }[];
  saving: boolean;
  onPatch: (id: string, cambios: Record<string, unknown>) => void | Promise<void>;
}) {
  const [editandoFecha, setEditandoFecha] = useState(false);
  const [editandoPausa, setEditandoPausa] = useState(false);
  const subtitulo = subtituloUtil({ cliente, titulo });

  /**
   * En la tarjeta de QA el selector cambia quién revisa; en la de un
   * programador, quién desarrolla.
   *
   * Mandar un proyecto a QA NO se hace desde acá: se hace poniendo la etapa en
   * "QA", que además asigna a la persona de QA. Si se pudiera elegir a la QA en
   * este selector, al no reemplazar al programador el control volvería a
   * mostrarlo y parecería que la acción no tuvo efecto.
   */
  function asignar(valor: string) {
    const campo = modo === "qa" ? "qa_responsable_id" : "responsable_tecnico_id";
    void onPatch(id, { [campo]: valor || null });
  }

  return (
    <li className={`px-4 py-3 transition-colors hover:bg-slate-50/70 ${saving ? "opacity-50" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-[11rem]">
          <Link
            href={`/dashboard/proyectos/${id}`}
            className="block truncate text-[13.5px] font-semibold text-slate-800 transition-colors hover:text-[#3F8E91]"
            title={etiquetaProyecto({ cliente, tipo })}
          >
            {cliente}
            {tipo ? (
              <span className="ml-1.5 text-[12px] font-normal text-slate-400">{tipo}</span>
            ) : null}
          </Link>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
            {subtitulo ? <span className="truncate">{subtitulo}</span> : null}
            {metaExtra ? <span>{metaExtra}</span> : null}
            {fechaPrometida ? <span>entrega {formatFecha(fechaPrometida)}</span> : null}
            {bloqueado ? <span className="font-semibold text-rose-600">bloqueado</span> : null}
            {qaChip ? (
              qaChip.etapa === "finalizado" ? (
                // Ciclo de QA cerrado: el proyecto ya no está en la tarjeta de
                // QA, así que este chip es la única puerta para volver a abrirlo.
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void onPatch(id, { qa_etapa: "revision_pre_entrega" })}
                  title={`QA aprobada por ${qaChip.nombre} — clic para volver a mandarlo a revisión`}
                  className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  QA ✓ · reabrir
                </button>
              ) : (
                <span
                  className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 font-medium text-indigo-700"
                  title={`En QA con ${qaChip.nombre} — ${qaEtapaLabel(qaChip.etapa)}`}
                >
                  QA · {qaEtapaLabel(qaChip.etapa)}
                </span>
              )
            ) : null}
          </div>
        </div>

        <DiasBadge
          dias={dias}
          diasEnEtapa={diasEnEtapa}
          asignado={asignadoA != null}
          pausado={pausado}
          activo={editandoFecha}
          onClick={modo === "dev" ? () => setEditandoFecha((v) => !v) : undefined}
          titulo={modo === "qa" ? "Días desde que se le asignó la revisión" : undefined}
        />

        <FancySelect
          size="sm"
          className="w-[10.5rem] shrink-0"
          ariaLabel={modo === "qa" ? "Etapa de QA" : "Etapa de desarrollo"}
          disabled={saving}
          options={opcionesEtapa}
          value={etapa}
          onChange={(v) => {
            if (v === OPCION_PAUSA) {
              setEditandoPausa(true);
              return;
            }
            const campo = modo === "qa" ? "qa_etapa" : "etapa_desarrollo";
            // Elegir una etapa real reanuda: la pausa no es un estado paralelo.
            void onPatch(id, pausado ? { [campo]: v, pausado: false } : { [campo]: v });
          }}
          triggerStyle={{ backgroundColor: `${color}12`, borderColor: `${color}55`, color }}
        />

        <FancySelect
          size="sm"
          className="w-[9.5rem] shrink-0"
          ariaLabel="Responsable"
          placeholder="Sin asignar"
          disabled={saving || opcionesUsuario.length <= 1}
          options={opcionesUsuario}
          value={asignadoA ?? ""}
          onChange={asignar}
        />
      </div>

      {pausado && !editandoPausa ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2">
          <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-amber-700">
            <IconPause />
            Pausado
          </span>
          <span className="min-w-0 flex-1 break-words text-[11px] text-amber-900">
            {pausaMotivo || "sin motivo cargado"}
          </span>
          {pausadoAt ? (
            <span className="text-[10px] text-amber-600">desde {formatDiaMes(pausadoAt)}</span>
          ) : null}
          <button
            type="button"
            onClick={() => setEditandoPausa(true)}
            className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 transition-colors hover:bg-amber-100"
          >
            Editar
          </button>
          <button
            type="button"
            onClick={() => void onPatch(id, { pausado: false })}
            className="rounded-md bg-white px-2 py-0.5 text-[11px] font-semibold text-emerald-700 shadow-sm ring-1 ring-emerald-200 transition-colors hover:bg-emerald-50"
          >
            Reanudar
          </button>
        </div>
      ) : null}

      {editandoPausa ? (
        <PausaForm
          motivoActual={pausaMotivo}
          onCancel={() => setEditandoPausa(false)}
          onSubmit={(motivo) => {
            setEditandoPausa(false);
            void onPatch(id, { pausado: true, pausa_motivo: motivo });
          }}
        />
      ) : null}

      {editandoFecha ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <span className="text-[11px] font-medium text-slate-600">Asignado el</span>
          <input
            type="date"
            defaultValue={isoADateInput(desde)}
            max={isoADateInput(new Date().toISOString())}
            onChange={(e) => {
              if (!e.target.value) return;
              void onPatch(id, {
                tecnico_asignado_at: new Date(`${e.target.value}T00:00:00`).toISOString(),
              });
              setEditandoFecha(false);
            }}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
          />
          <span className="text-[11px] text-slate-400">
            Corregí la fecha si el contador arrancó desde la creación del proyecto.
          </span>
          <button
            type="button"
            onClick={() => setEditandoFecha(false)}
            className="ml-auto text-[11px] font-medium text-slate-500 transition-colors hover:text-slate-700"
          >
            Cancelar
          </button>
        </div>
      ) : null}
    </li>
  );
}

/** Editor del motivo de pausa. El motivo es obligatorio: sin él la pausa no dice nada. */
function PausaForm({
  motivoActual,
  onSubmit,
  onCancel,
}: {
  motivoActual: string | null;
  onSubmit: (motivo: string) => void;
  onCancel: () => void;
}) {
  const [motivo, setMotivo] = useState(motivoActual ?? "");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const limpio = motivo.trim();
        if (limpio) onSubmit(limpio);
      }}
      className="mt-2.5 space-y-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2.5"
    >
      <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-700">
        <IconPause />
        Motivo de la pausa
      </label>
      <input
        autoFocus
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="Ej: esperando contenido del cliente"
        className="w-full rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-[12px] text-slate-800 outline-none placeholder:text-slate-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-200"
      />
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-amber-700">
          Se ve en el tablero y va en el mensaje de WhatsApp. El contador de días se congela.
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="ml-auto rounded-md px-2 py-1 text-[11px] font-semibold text-slate-500 transition-colors hover:text-slate-700"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={!motivo.trim()}
          className="rounded-md bg-amber-500 px-3 py-1 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-amber-200"
        >
          Pausar
        </button>
      </div>
    </form>
  );
}

/**
 * El contador son los días desde la asignación, descontando el tiempo pausado.
 * Sin responsable el contador no corre: se muestra inerte, sin color de alerta.
 */
function DiasBadge({
  dias,
  diasEnEtapa,
  asignado,
  pausado,
  activo,
  onClick,
  titulo,
}: {
  dias: number | null;
  diasEnEtapa: number | null;
  asignado: boolean;
  pausado: boolean;
  activo: boolean;
  onClick?: () => void;
  titulo?: string;
}) {
  if (!asignado || dias == null) {
    return (
      <span
        className="inline-flex min-w-[3.1rem] items-center justify-center rounded-lg border border-dashed border-slate-200 px-2 py-1.5 text-[11px] font-medium text-slate-300"
        title={
          asignado
            ? "Sin fecha de asignación"
            : "El contador arranca cuando se le asigna el proyecto a un programador"
        }
      >
        —
      </span>
    );
  }

  // Pausado gana sobre el color de alerta: los días están congelados, no atrasados.
  const tono = pausado
    ? "border-amber-200 bg-amber-50 text-amber-700"
    : dias >= 30
      ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
      : dias >= 14
        ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
        : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100";

  const title =
    titulo ??
    (pausado
      ? "Días trabajados — congelado mientras el proyecto está pausado"
      : diasEnEtapa == null
        ? "Días desde que se asignó al programador — clic para corregir la fecha"
        : `Días desde la asignación · ${diasEnEtapa} d en la etapa actual — clic para corregir la fecha`);

  const contenido = (
    <>
      {pausado ? <IconPause /> : null}
      {dias}
      <span className="font-medium opacity-60">d</span>
    </>
  );

  const clases = `inline-flex min-w-[3.1rem] items-center justify-center gap-0.5 rounded-lg border px-2 py-1.5 text-[11px] font-bold tabular-nums transition-colors ${tono} ${
    activo ? "ring-2 ring-[#4FAEB2]/30" : ""
  }`;

  if (!onClick) {
    return (
      <span className={clases} title={title}>
        {contenido}
      </span>
    );
  }

  return (
    <button type="button" onClick={onClick} aria-expanded={activo} title={title} className={clases}>
      {contenido}
    </button>
  );
}

function FinalizadosSeccion({ data, mes }: { data: TareasEquipoData | null; mes: string }) {
  const grupos = data?.finalizados_por_programador ?? [];

  if (grupos.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
        <p className="text-sm font-medium text-slate-700">Sin proyectos finalizados</p>
        <p className="mt-1 text-xs text-slate-500">
          Ningún proyecto pasó a etapa “Finalizado” en {formatMesLargo(mes)}.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {grupos.map((g) => {
        const key = g.tecnico_id ?? "__SIN__";
        const sinTecnico = g.tecnico_id == null;
        const col = sinTecnico ? { bg: "#94a3b8", soft: "rgba(148,163,184,0.10)" } : paleta(g.tecnico_nombre);
        return (
          <TarjetaGrupo
            key={key}
            color={col}
            inicial={sinTecnico ? "—" : initials(g.tecnico_nombre)}
            titulo={sinTecnico ? "Sin asignar" : nombreCorto(g.tecnico_nombre)}
            italic={sinTecnico}
            subtitulo={`${g.cantidad === 1 ? "1 finalizado" : `${g.cantidad} finalizados`}${
              g.promedio_dias != null ? ` · promedio ${g.promedio_dias} d` : ""
            }`}
            contador={g.cantidad}
          >
            <ul className="divide-y divide-slate-100">
              {g.proyectos.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/dashboard/proyectos/${p.id}`}
                      className="block truncate text-[13px] font-semibold text-slate-800 transition-colors hover:text-[#3F8E91]"
                      title={etiquetaProyecto(p)}
                    >
                      {p.cliente}
                      {p.tipo ? <span className="ml-1.5 font-normal text-slate-400">{p.tipo}</span> : null}
                    </Link>
                    <div className="truncate text-[11px] text-slate-500">
                      Finalizado el {formatFecha(p.finalizado_at)}
                    </div>
                  </div>
                  <span
                    className="shrink-0 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-bold tabular-nums text-emerald-700"
                    title="Días trabajados desde la asignación hasta finalizar (sin contar pausas)"
                  >
                    {p.dias_tardados == null ? "—" : `${p.dias_tardados} d`}
                  </span>
                </li>
              ))}
            </ul>
          </TarjetaGrupo>
        );
      })}
    </div>
  );
}

/* --- Íconos ------------------------------------------------------------- */

const SVG_PROPS = {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: "h-3.5 w-3.5",
  "aria-hidden": true,
};

function IconCopy() {
  return (
    <svg {...SVG_PROPS}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg {...SVG_PROPS}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconChevronLeft() {
  return (
    <svg {...SVG_PROPS}>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function IconChevronRight() {
  return (
    <svg {...SVG_PROPS}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function IconPause() {
  return (
    <svg {...SVG_PROPS} className="h-3 w-3">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg {...SVG_PROPS} className="h-3 w-3">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  );
}
