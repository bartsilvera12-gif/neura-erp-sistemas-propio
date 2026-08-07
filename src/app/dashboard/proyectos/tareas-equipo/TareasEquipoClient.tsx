"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import {
  PROYECTO_ETAPAS,
  etapaColor,
  etapaLabel,
  type ProyectoEtapaDesarrollo,
} from "@/lib/proyectos/etapas-desarrollo";

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
};

type GrupoActivo = {
  tecnico_id: string | null;
  tecnico_nombre: string;
  cantidad: number;
  proyectos: ActivoItem[];
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
  finalizados_total: number;
  finalizados_por_programador: GrupoFinalizado[];
};

type Usuario = { id: string; nombre?: string | null };

type ApiResponse = { success: boolean; data?: TareasEquipoData; error?: string };

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
 * Arma el mensaje con el formato que el equipo ya usa en WhatsApp,
 * agregando etapa y contador de días a cada línea de cliente.
 */
function buildMensajeWhatsapp(grupos: GrupoActivo[]): string {
  const lineas: string[] = ["*Tareas del equipo*", `*${formatFechaCorta(new Date())}*`, ""];

  for (const g of grupos) {
    if (g.proyectos.length === 0) continue;

    lineas.push("*Cliente:*");
    for (const p of g.proyectos) {
      const dias = p.dias == null ? "" : ` · ${p.dias}d`;
      lineas.push(`•${etiquetaProyecto(p)} — ${etapaLabel(p.etapa_desarrollo)}${dias}`);
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
    () => buildMensajeWhatsapp(data?.activos_por_programador ?? []),
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
            Proyectos por programador, con etapa y días desde que se le asignó.
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
      <span className="hidden sm:inline">Días asignado:</span>
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

function ActivosSeccion({
  grupos,
  usuarios,
  savingId,
  onPatch,
}: {
  grupos: GrupoActivo[];
  usuarios: Usuario[];
  savingId: string | null;
  onPatch: (id: string, cambios: Record<string, unknown>) => void | Promise<void>;
}) {
  if (grupos.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
        <p className="text-sm font-medium text-slate-700">No hay proyectos en curso</p>
        <p className="mt-1 text-xs text-slate-500">
          Todos los proyectos activos están en etapa “Finalizado” o no hay proyectos cargados.
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
          <section
            key={key}
            className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md"
          >
            <header
              className="flex items-center gap-3 border-b border-slate-100 px-4 py-3"
              style={{ backgroundColor: col.soft }}
            >
              <span
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ring-2 ring-white"
                style={{ backgroundColor: col.bg }}
                aria-hidden="true"
              >
                {sinTecnico ? "—" : initials(g.tecnico_nombre)}
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className={`truncate text-sm font-semibold ${sinTecnico ? "italic text-slate-500" : "text-slate-900"}`}
                  title={g.tecnico_nombre}
                >
                  {sinTecnico ? "Sin asignar" : nombreCorto(g.tecnico_nombre)}
                </div>
                <div className="text-[11px] text-slate-500">
                  {g.cantidad === 1 ? "1 proyecto" : `${g.cantidad} proyectos`}
                </div>
              </div>
              <span
                className="shrink-0 rounded-full px-2.5 py-1 text-[13px] font-bold tabular-nums text-white"
                style={{ backgroundColor: col.bg }}
              >
                {g.cantidad}
              </span>
            </header>

            <ul className="divide-y divide-slate-100">
              {g.proyectos.map((p) => (
                <FilaProyecto
                  key={p.id}
                  proyecto={p}
                  tecnicoId={g.tecnico_id}
                  usuarios={usuarios}
                  saving={savingId === p.id}
                  onPatch={onPatch}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function FilaProyecto({
  proyecto: p,
  tecnicoId,
  usuarios,
  saving,
  onPatch,
}: {
  proyecto: ActivoItem;
  tecnicoId: string | null;
  usuarios: Usuario[];
  saving: boolean;
  onPatch: (id: string, cambios: Record<string, unknown>) => void | Promise<void>;
}) {
  const [editandoFecha, setEditandoFecha] = useState(false);
  const subtitulo = subtituloUtil(p);
  const color = etapaColor(p.etapa_desarrollo);

  return (
    <li className={`px-4 py-3 transition-opacity ${saving ? "opacity-50" : ""}`}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <Link
            href={`/dashboard/proyectos/${p.id}`}
            className="block truncate text-[13px] font-semibold text-slate-800 transition-colors hover:text-[#3F8E91]"
            title={etiquetaProyecto(p)}
          >
            {p.cliente}
            {p.tipo ? <span className="ml-1.5 font-normal text-slate-400">{p.tipo}</span> : null}
          </Link>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
            {subtitulo ? <span className="truncate">{subtitulo}</span> : null}
            {p.fecha_prometida ? <span>entrega {formatFecha(p.fecha_prometida)}</span> : null}
            {p.bloqueado ? <span className="font-semibold text-rose-600">bloqueado</span> : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <DiasBadge
            dias={p.dias}
            diasEnEtapa={p.dias_en_etapa}
            activo={editandoFecha}
            onClick={() => setEditandoFecha((v) => !v)}
          />

          <select
            value={p.etapa_desarrollo}
            disabled={saving}
            onChange={(e) => void onPatch(p.id, { etapa_desarrollo: e.target.value })}
            aria-label="Etapa de desarrollo"
            className="cursor-pointer rounded-lg border-0 py-1.5 pl-2.5 pr-7 text-[11px] font-semibold outline-none ring-1 ring-inset transition-shadow focus:ring-2 disabled:cursor-wait"
            style={{ backgroundColor: `${color}14`, color, boxShadow: `inset 0 0 0 1px ${color}44` }}
          >
            {PROYECTO_ETAPAS.map((e) => (
              <option key={e.codigo} value={e.codigo} style={{ color: "#0f172a", backgroundColor: "#fff" }}>
                {e.label}
              </option>
            ))}
          </select>

          <select
            value={tecnicoId ?? ""}
            disabled={saving || usuarios.length === 0}
            onChange={(e) => void onPatch(p.id, { responsable_tecnico_id: e.target.value || null })}
            aria-label="Programador asignado"
            title="Reasignar a otro programador (reinicia el contador de días)"
            className="max-w-[9.5rem] cursor-pointer truncate rounded-lg border border-slate-200 bg-white py-1.5 pl-2 pr-6 text-[11px] font-medium text-slate-600 outline-none transition-colors hover:border-[#4FAEB2]/60 focus:border-[#4FAEB2] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">Sin asignar</option>
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>
                {nombreCorto(u.nombre ?? "")}
              </option>
            ))}
          </select>
        </div>
      </div>

      {editandoFecha ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <span className="text-[11px] font-medium text-slate-600">Asignado el</span>
          <input
            type="date"
            defaultValue={isoADateInput(p.desde)}
            max={isoADateInput(new Date().toISOString())}
            onChange={(e) => {
              if (!e.target.value) return;
              void onPatch(p.id, { tecnico_asignado_at: new Date(`${e.target.value}T00:00:00`).toISOString() });
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

/** El contador principal son los días desde la asignación al programador. */
function DiasBadge({
  dias,
  diasEnEtapa,
  activo,
  onClick,
}: {
  dias: number | null;
  diasEnEtapa: number | null;
  activo: boolean;
  onClick: () => void;
}) {
  const tono =
    dias == null
      ? "border-slate-200 bg-white text-slate-400"
      : dias >= 30
        ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
        : dias >= 14
          ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
          : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={activo}
      title={
        diasEnEtapa == null
          ? "Días desde que se asignó al programador — clic para corregir la fecha"
          : `Días desde la asignación · ${diasEnEtapa} d en la etapa actual — clic para corregir la fecha`
      }
      className={`inline-flex min-w-[3.1rem] items-center justify-center gap-0.5 rounded-lg border px-2 py-1.5 text-[11px] font-bold tabular-nums transition-colors ${tono} ${
        activo ? "ring-2 ring-[#4FAEB2]/30" : ""
      }`}
    >
      {dias == null ? "—" : dias}
      {dias == null ? null : <span className="font-medium opacity-60">d</span>}
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
          <section
            key={key}
            className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md"
          >
            <header
              className="flex items-center gap-3 border-b border-slate-100 px-4 py-3"
              style={{ backgroundColor: col.soft }}
            >
              <span
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ring-2 ring-white"
                style={{ backgroundColor: col.bg }}
                aria-hidden="true"
              >
                {sinTecnico ? "—" : initials(g.tecnico_nombre)}
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className={`truncate text-sm font-semibold ${sinTecnico ? "italic text-slate-500" : "text-slate-900"}`}
                  title={g.tecnico_nombre}
                >
                  {sinTecnico ? "Sin asignar" : nombreCorto(g.tecnico_nombre)}
                </div>
                <div className="text-[11px] text-slate-500">
                  {g.cantidad === 1 ? "1 finalizado" : `${g.cantidad} finalizados`}
                  {g.promedio_dias != null ? ` · promedio ${g.promedio_dias} d` : ""}
                </div>
              </div>
              <span
                className="shrink-0 rounded-full px-2.5 py-1 text-[13px] font-bold tabular-nums text-white"
                style={{ backgroundColor: col.bg }}
              >
                {g.cantidad}
              </span>
            </header>

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
                    title="Días desde la asignación al programador hasta finalizar"
                  >
                    {p.dias_tardados == null ? "—" : `${p.dias_tardados} d`}
                  </span>
                </li>
              ))}
            </ul>
          </section>
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
