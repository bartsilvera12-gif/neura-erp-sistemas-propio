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

type ApiResponse = { success: boolean; data?: TareasEquipoData; error?: string };

const AVATAR_PALETTE = [
  "bg-[#4FAEB2] text-white",
  "bg-violet-500 text-white",
  "bg-amber-500 text-white",
  "bg-emerald-600 text-white",
  "bg-rose-500 text-white",
  "bg-sky-600 text-white",
  "bg-indigo-500 text-white",
  "bg-fuchsia-500 text-white",
];

function avatarClass(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h += name.charCodeAt(i);
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

function initials(name: string) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
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
    lineas.push(`•${g.tecnico_nombre}`);

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

  const cambiarEtapa = useCallback(
    async (proyectoId: string, etapa: ProyectoEtapaDesarrollo) => {
      setSavingId(proyectoId);
      setErr(null);
      try {
        const res = await fetchWithSupabaseSession(`/api/proyectos/${proyectoId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ etapa_desarrollo: etapa }),
        });
        const j = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
        if (!res.ok || !j?.success) {
          setErr(j?.error ?? "No se pudo cambiar la etapa");
          return;
        }
        // Al pasar a Finalizado el proyecto sale del listado activo y entra al
        // reporte del mes: hay que recargar los dos bloques.
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

  const totalFinalizados = data?.finalizados_total ?? 0;

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 shrink-0 rounded-full bg-[#4FAEB2] shadow-[0_0_0_3px_rgba(79,174,178,0.18)]"
            />
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#4FAEB2]">
              Equipo
            </p>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            Tareas del equipo
          </h1>
          <p className="text-sm text-slate-500">
            Proyectos por programador, con etapa de desarrollo y días desde la asignación.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void copiar()}
            disabled={!mensaje}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#4FAEB2] px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#3F8E91] disabled:cursor-not-allowed disabled:opacity-50"
            title="Copiar el pase del día con el formato de WhatsApp"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3.5 w-3.5"
              aria-hidden="true"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            {copiado ? "¡Copiado!" : "Copiar para WhatsApp"}
          </button>
          <Link
            href="/dashboard/proyectos"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm transition-colors hover:border-[#4FAEB2]/60 hover:text-[#4FAEB2]"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3.5 w-3.5"
              aria-hidden="true"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Volver al tablero
          </Link>
        </div>
      </div>

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
            Finalizados ({totalFinalizados})
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
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
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
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
            <span className="ml-2 hidden text-sm text-slate-500 sm:inline">{formatMesLargo(mes)}</span>
          </div>
        ) : null}
      </div>

      {err ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{err}</div>
      ) : null}

      {loading && !data ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
          Cargando tablero…
        </div>
      ) : verFinalizados ? (
        <FinalizadosSeccion data={data} mes={mes} />
      ) : (
        <>
          <ActivosSeccion
            grupos={data?.activos_por_programador ?? []}
            savingId={savingId}
            onCambiarEtapa={cambiarEtapa}
          />
          {mensaje ? (
            <details className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <summary className="cursor-pointer select-none px-4 py-3 text-xs font-semibold text-slate-600 transition-colors hover:text-[#3F8E91]">
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

function ActivosSeccion({
  grupos,
  savingId,
  onCambiarEtapa,
}: {
  grupos: GrupoActivo[];
  savingId: string | null;
  onCambiarEtapa: (id: string, etapa: ProyectoEtapaDesarrollo) => void | Promise<void>;
}) {
  if (grupos.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
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
        return (
          <section
            key={key}
            className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
          >
            <header className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
              <span
                className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ring-2 ring-white ${
                  sinTecnico ? "bg-slate-300 text-white" : avatarClass(g.tecnico_nombre)
                }`}
                aria-hidden="true"
              >
                {sinTecnico ? "—" : initials(g.tecnico_nombre)}
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className={`truncate text-[13.5px] font-semibold ${
                    sinTecnico ? "italic text-slate-500" : "text-slate-900"
                  }`}
                  title={g.tecnico_nombre}
                >
                  {g.tecnico_nombre}
                </div>
                <div className="text-[11px] text-slate-500">
                  {g.cantidad === 1 ? "1 proyecto en curso" : `${g.cantidad} proyectos en curso`}
                </div>
              </div>
            </header>

            <ul className="divide-y divide-slate-100">
              {g.proyectos.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/dashboard/proyectos/${p.id}`}
                      className="block truncate text-[12.5px] font-semibold text-slate-800 transition-colors hover:text-[#3F8E91]"
                      title={p.titulo}
                    >
                      {etiquetaProyecto(p)}
                    </Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                      <span className="truncate">{p.titulo}</span>
                      {p.fecha_prometida ? (
                        <span className="text-slate-400">· entrega {formatFecha(p.fecha_prometida)}</span>
                      ) : null}
                      {p.bloqueado ? (
                        <span className="font-semibold text-rose-600">· bloqueado</span>
                      ) : null}
                    </div>
                  </div>

                  <DiasBadge dias={p.dias} diasEnEtapa={p.dias_en_etapa} />

                  <EtapaSelect
                    value={p.etapa_desarrollo}
                    disabled={savingId === p.id}
                    onChange={(etapa) => void onCambiarEtapa(p.id, etapa)}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** El contador principal son los días desde la asignación al programador. */
function DiasBadge({ dias, diasEnEtapa }: { dias: number | null; diasEnEtapa: number | null }) {
  if (dias == null) {
    return <span className="shrink-0 text-[11px] text-slate-400">sin fecha</span>;
  }
  const tono =
    dias >= 30
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : dias >= 14
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-slate-200 bg-slate-50 text-slate-600";
  return (
    <span
      className={`inline-flex shrink-0 items-baseline gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold tabular-nums ${tono}`}
      title={
        diasEnEtapa == null
          ? "Días desde que se asignó al programador"
          : `Días desde la asignación al programador · ${diasEnEtapa} d en la etapa actual`
      }
    >
      {dias}
      <span className="font-normal opacity-70">d</span>
    </span>
  );
}

function EtapaSelect({
  value,
  disabled,
  onChange,
}: {
  value: ProyectoEtapaDesarrollo;
  disabled: boolean;
  onChange: (etapa: ProyectoEtapaDesarrollo) => void;
}) {
  const color = etapaColor(value);
  return (
    <label className="shrink-0">
      <span className="sr-only">Etapa de desarrollo</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as ProyectoEtapaDesarrollo)}
        className="rounded-lg border bg-white px-2 py-1.5 text-[11px] font-semibold outline-none transition-colors disabled:cursor-wait disabled:opacity-60"
        style={{ borderColor: `${color}66`, color }}
      >
        {PROYECTO_ETAPAS.map((e) => (
          <option key={e.codigo} value={e.codigo}>
            {e.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FinalizadosSeccion({ data, mes }: { data: TareasEquipoData | null; mes: string }) {
  const grupos = data?.finalizados_por_programador ?? [];

  if (grupos.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
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
        return (
          <section
            key={key}
            className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
          >
            <header className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
              <span
                className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ring-2 ring-white ${
                  sinTecnico ? "bg-slate-300 text-white" : avatarClass(g.tecnico_nombre)
                }`}
                aria-hidden="true"
              >
                {sinTecnico ? "—" : initials(g.tecnico_nombre)}
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className={`truncate text-[13.5px] font-semibold ${
                    sinTecnico ? "italic text-slate-500" : "text-slate-900"
                  }`}
                  title={g.tecnico_nombre}
                >
                  {g.tecnico_nombre}
                </div>
                <div className="text-[11px] text-slate-500">
                  {g.cantidad === 1 ? "1 proyecto finalizado" : `${g.cantidad} proyectos finalizados`}
                  {g.promedio_dias != null ? ` · promedio ${g.promedio_dias} d` : ""}
                </div>
              </div>
              <div className="shrink-0 text-2xl font-semibold tabular-nums text-slate-900">
                {g.cantidad}
              </div>
            </header>

            <ul className="divide-y divide-slate-100 bg-slate-50/40">
              {g.proyectos.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/dashboard/proyectos/${p.id}`}
                      className="block truncate text-[12.5px] font-semibold text-slate-800 transition-colors hover:text-[#3F8E91]"
                      title={p.titulo}
                    >
                      {etiquetaProyecto(p)}
                    </Link>
                    <div className="truncate text-[11px] text-slate-500">
                      Finalizado el {formatFecha(p.finalizado_at)}
                    </div>
                  </div>
                  <span
                    className="shrink-0 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold tabular-nums text-emerald-700"
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
