"use client";

/**
 * Piezas visuales compartidas por los dashboards de Proyectos.
 *
 * Salieron tal cual del Dashboard SLA, que ya había fijado la estética: tarjeta
 * con spotlight, píldora de filtro con etiqueta y valor en la misma caja, KPI
 * con círculo + ícono y número animado. Se extrajeron acá para que el Ejecutivo
 * y el PM no las vuelvan a escribir cada uno a su manera — tres copias del
 * mismo botón terminan siendo tres botones distintos.
 */

import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, Info } from "lucide-react";
import CountUp from "@/components/reactbits/CountUp";
import SpotlightCard from "@/components/reactbits/SpotlightCard";

export const TEAL = "#4FAEB2";
export const VERDE = "#22c55e";
export const AMBAR = "#f5b544";
export const NARANJA = "#f97316";
export const ROJO = "#ef6461";

export type Opcion = { id: string; nombre: string };

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <SpotlightCard
      className={`rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}
      spotlightColor="rgba(79, 174, 178, 0.10)"
    >
      {children}
    </SpotlightCard>
  );
}

export function CardTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <h2 className="truncate text-[13px] font-semibold text-slate-700">{children}</h2>
        <Info className="h-3.5 w-3.5 shrink-0 text-slate-300" />
      </div>
      {right}
    </div>
  );
}

export function FiltroPill({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <span className="shrink-0 text-[13px] font-medium text-slate-600">{label}</span>
      <div className="relative min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Selector propio con la estética de la píldora. Con más de 8 opciones, busca. */
export function PillSelect({
  label,
  value,
  onChange,
  options,
  placeholder = "Todos",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Opcion[];
  placeholder?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setAbierto(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setAbierto(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [abierto]);

  const seleccionada = options.find((o) => o.id === value) ?? null;
  const buscable = options.length > 8;
  const filtradas = q.trim()
    ? options.filter((o) => o.nombre.toLowerCase().includes(q.trim().toLowerCase()))
    : options;

  return (
    <div
      ref={ref}
      className="relative flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <span className="shrink-0 text-[13px] font-medium text-slate-600">{label}</span>
      <button
        type="button"
        onClick={() => {
          setAbierto((v) => !v);
          setQ("");
        }}
        className="flex min-w-0 flex-1 items-center justify-end gap-1 focus:outline-none"
        title={seleccionada?.nombre ?? placeholder}
      >
        <span className={`truncate text-[13px] ${seleccionada ? "text-slate-700" : "text-slate-400"}`}>
          {seleccionada ? seleccionada.nombre : placeholder}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${abierto ? "rotate-180" : ""}`}
        />
      </button>

      {abierto ? (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          {buscable ? (
            <div className="border-b border-slate-100 p-2">
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar…"
                className="w-full rounded-lg bg-slate-50 px-2.5 py-1.5 text-[12px] text-slate-700 placeholder:text-slate-400 focus:outline-none"
              />
            </div>
          ) : null}
          <ul className="max-h-56 overflow-y-auto py-1">
            <li>
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setAbierto(false);
                }}
                className={`w-full px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-slate-50 ${
                  !value ? "font-semibold text-[#2F6E71]" : "text-slate-600"
                }`}
              >
                {placeholder}
              </button>
            </li>
            {filtradas.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(o.id);
                    setAbierto(false);
                  }}
                  title={o.nombre}
                  className={`block w-full truncate px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-slate-50 ${
                    value === o.id ? "font-semibold text-[#2F6E71]" : "text-slate-600"
                  }`}
                >
                  {o.nombre}
                </button>
              </li>
            ))}
            {filtradas.length === 0 ? (
              <li className="px-3 py-2 text-center text-[11px] text-slate-400">Sin resultados</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export type KpiTono = { circulo: string; icono: string };

export const TONO: Record<string, KpiTono> = {
  teal: { circulo: "bg-[#4FAEB2]/12", icono: "text-[#4FAEB2]" },
  verde: { circulo: "bg-emerald-50", icono: "text-emerald-500" },
  rojo: { circulo: "bg-rose-50", icono: "text-rose-500" },
  ambar: { circulo: "bg-amber-50", icono: "text-amber-500" },
  naranja: { circulo: "bg-orange-50", icono: "text-orange-500" },
  azul: { circulo: "bg-sky-50", icono: "text-sky-500" },
  violeta: { circulo: "bg-violet-50", icono: "text-violet-500" },
  gris: { circulo: "bg-slate-100", icono: "text-slate-500" },
};

/** KPI del diseño: círculo con ícono + etiqueta al lado, número grande y pie. */
export function Kpi({
  icon: Icon,
  tono,
  label,
  sublabel,
  numero,
  sufijo,
  texto,
  pie,
  pieBueno,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tono: KpiTono;
  label: string;
  sublabel?: string;
  numero?: number;
  sufijo?: string;
  texto?: string;
  pie?: string | null;
  pieBueno?: boolean;
  onClick?: () => void;
}) {
  const contenido = (
    <Card className={onClick ? "cursor-pointer transition-shadow hover:shadow-md" : ""}>
      <div className="flex items-start gap-2.5">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${tono.circulo}`}>
          <Icon className={`h-4 w-4 ${tono.icono}`} />
        </span>
        <span className="min-w-0 pt-0.5 text-[12px] leading-tight text-slate-500">
          {label}
          {sublabel ? <span className="block text-[10px] text-slate-400">{sublabel}</span> : null}
        </span>
      </div>
      <div className="mt-2 text-[26px] font-bold leading-none tracking-tight text-slate-800">
        {numero != null ? <CountUp to={numero} separator="." duration={1} /> : texto}
        {sufijo}
      </div>
      {pie ? (
        <div className={`mt-1.5 text-[11px] font-medium ${pieBueno === false ? "text-rose-500" : pieBueno === true ? "text-emerald-600" : "text-slate-400"}`}>
          {pie}
        </div>
      ) : (
        <div className="mt-1.5 text-[11px] text-slate-300">—</div>
      )}
    </Card>
  );
  if (!onClick) return contenido;
  return (
    <div role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => e.key === "Enter" && onClick()}>
      {contenido}
    </div>
  );
}

/** Píldora de estado, pintada con el color que configuró la empresa. */
export function EstadoPill({ nombre, color }: { nombre: string; color: string }) {
  return (
    <span
      className="inline-block max-w-full truncate whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: `${color}1A`, color }}
      title={nombre}
    >
      {nombre}
    </span>
  );
}

export function Pill({
  children,
  className = "",
  style,
}: {
  children: React.ReactNode;
  className?: string;
  /** Para píldoras pintadas con el color configurado del estado o del tipo. */
  style?: React.CSSProperties;
}) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}
      style={style}
    >
      {children}
    </span>
  );
}

// --- Formatos ----------------------------------------------------------------

export function fmtFecha(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Duración laboral legible, SIEMPRE en horas: `45 min`, `4,5 h`, `444 h`.
 *
 * Antes pasaba a jornadas por encima de las nueve horas y eso obligaba a hacer
 * una cuenta mental para comparar dos celdas de la misma columna. En un tablero
 * de desarrollo la unidad de trabajo es la hora, así que se muestran horas y
 * listo. Por debajo de diez se usa un decimal, porque ahí la diferencia entre
 * 4 y 4,5 importa; por encima el decimal es ruido.
 */
export function fmtDur(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const horas = ms / 3600_000;
  if (horas < 1) return `${Math.max(0, Math.round(ms / 60_000))} min`;
  if (horas < 10) return `${(Math.round(horas * 10) / 10).toString().replace(".", ",")} h`;
  return `${Math.round(horas)} h`;
}

/** Días a la fecha prometida, con signo: `−4d` vencido, `+2d` por vencer. */
export function fmtDias(dias: number | null): string {
  if (dias == null) return "—";
  if (dias === 0) return "Hoy";
  return dias < 0 ? `−${Math.abs(dias)}d` : `+${dias}d`;
}

export function Estado({
  loading,
  error,
  vacio,
  children,
}: {
  loading: boolean;
  error: string | null;
  vacio: boolean;
  children: React.ReactNode;
}) {
  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
    );
  }
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-[118px] animate-pulse rounded-xl border border-slate-200 bg-slate-100/70" />
        ))}
      </div>
    );
  }
  if (vacio) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
        No hay proyectos para estos filtros.
      </div>
    );
  }
  return <>{children}</>;
}

/** Tabla con scroll propio: el ancho de una tabla nunca empuja el layout. */
export function TablaWrap({ children }: { children: React.ReactNode }) {
  return <div className="-mx-1 overflow-x-auto px-1">{children}</div>;
}
