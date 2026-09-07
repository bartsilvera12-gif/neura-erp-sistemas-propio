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
import { Check, ChevronDown, Info, Search } from "lucide-react";
import CountUp from "@/components/reactbits/CountUp";
import SpotlightCard from "@/components/reactbits/SpotlightCard";

export const TEAL = "#4FAEB2";
export const VERDE = "#22c55e";
export const AMBAR = "#f5b544";
export const NARANJA = "#f97316";
export const ROJO = "#ef6461";

export type Opcion = {
  id: string;
  nombre: string;
  /** Color configurado de la opción; los estados traen el suyo del catálogo. */
  color?: string | null;
};

/**
 * Paleta para los avatares de personas.
 *
 * El color se deriva del id y no de la posición en la lista: así una misma
 * persona se ve siempre igual, aunque se filtre o cambie el orden.
 */
const PALETA_PERSONA = ["#4FAEB2", "#8b5cf6", "#f59e0b", "#ec4899", "#22c55e", "#0ea5e9", "#ef4444"];

function colorDePersona(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETA_PERSONA[h % PALETA_PERSONA.length];
}

function inicialesDe(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  return ((partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** Punto de color o avatar con iniciales, según qué lista se esté mostrando. */
function Marca({ opcion, variante }: { opcion: Opcion; variante: "color" | "persona" | "simple" }) {
  if (variante === "persona") {
    const c = colorDePersona(opcion.id);
    return (
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[8.5px] font-bold"
        style={{ background: `${c}22`, color: c }}
      >
        {inicialesDe(opcion.nombre)}
      </span>
    );
  }
  if (variante === "color" && opcion.color) {
    return (
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ background: opcion.color, boxShadow: `0 0 0 3px ${opcion.color}22` }}
      />
    );
  }
  return null;
}

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

/**
 * Filtro de fecha que abre el calendario al tocar CUALQUIER parte de la
 * píldora, no sólo el iconito.
 *
 * Un `<input type="date">` nativo sólo despliega el almanaque desde su ícono:
 * al hacer clic sobre el texto se entra a editar el día a mano, que es lo
 * último que quiere alguien filtrando un tablero. `showPicker()` lo abre a
 * pedido; va dentro de un try porque Safari no lo implementa y algunos
 * navegadores lo rechazan si la llamada no viene de un gesto del usuario. Si
 * falla, el campo sigue funcionando como antes.
 */
export function FiltroFecha({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  const abrir = () => {
    const el = ref.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!el) return;
    el.focus();
    try {
      el.showPicker?.();
    } catch {
      /* Navegador sin soporte: queda el comportamiento nativo. */
    }
  };

  return (
    <div
      onClick={abrir}
      className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-[#4FAEB2]/50"
    >
      <span className="shrink-0 text-[13px] font-medium text-slate-600">{label}</span>
      <div className="relative min-w-0 flex-1">
        <input
          ref={ref}
          type="date"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(e.target.value)}
          className="w-full cursor-pointer bg-transparent text-right text-[13px] text-slate-500 focus:outline-none"
        />
      </div>
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
  variante = "simple",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Opcion[];
  placeholder?: string;
  /** `color` pinta el color de la opción; `persona`, un avatar con iniciales. */
  variante?: "color" | "persona" | "simple";
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
      className={`relative flex items-center gap-2 rounded-xl border bg-white px-3 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors ${
        abierto || seleccionada ? "border-[#4FAEB2]/60" : "border-slate-200 hover:border-[#4FAEB2]/40"
      }`}
    >
      <span className="shrink-0 text-[13px] font-medium text-slate-600">{label}</span>
      <button
        type="button"
        onClick={() => {
          setAbierto((v) => !v);
          setQ("");
        }}
        className="flex min-w-0 flex-1 items-center justify-end gap-1.5 focus:outline-none"
        title={seleccionada?.nombre ?? placeholder}
      >
        {seleccionada ? <Marca opcion={seleccionada} variante={variante} /> : null}
        <span
          className={`truncate text-[13px] ${seleccionada ? "font-medium text-[#2F6E71]" : "text-slate-400"}`}
        >
          {seleccionada ? seleccionada.nombre : placeholder}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform ${
            abierto ? "rotate-180 text-[#4FAEB2]" : "text-slate-400"
          }`}
        />
      </button>

      {abierto ? (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-xl border border-[#4FAEB2]/25 bg-white shadow-xl shadow-slate-900/10">
          {buscable ? (
            <div className="border-b border-slate-100 p-2">
              <div className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1.5 focus-within:bg-white focus-within:ring-1 focus-within:ring-[#4FAEB2]/40">
                <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar…"
                  className="w-full bg-transparent text-[12px] text-slate-700 placeholder:text-slate-400 focus:outline-none"
                />
              </div>
            </div>
          ) : null}
          <ul className="max-h-60 overflow-y-auto p-1">
            <li>
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setAbierto(false);
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] transition-colors ${
                  !value ? "bg-[#4FAEB2]/10 font-semibold text-[#2F6E71]" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-dashed border-slate-300" />
                <span className="min-w-0 flex-1 truncate">{placeholder}</span>
                {!value ? <Check className="h-3.5 w-3.5 shrink-0 text-[#4FAEB2]" /> : null}
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
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] transition-colors ${
                    value === o.id
                      ? "bg-[#4FAEB2]/10 font-semibold text-[#2F6E71]"
                      : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <Marca opcion={o} variante={variante} />
                  <span className="min-w-0 flex-1 truncate">{o.nombre}</span>
                  {value === o.id ? <Check className="h-3.5 w-3.5 shrink-0 text-[#4FAEB2]" /> : null}
                </button>
              </li>
            ))}
            {filtradas.length === 0 ? (
              <li className="px-3 py-3 text-center text-[11px] text-slate-400">Sin resultados</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Cabecera de un tablero.
 *
 * Antes eran tres líneas de texto gris apiladas, del mismo peso, compitiendo
 * entre sí: el título no se despegaba y el contexto (qué cartera, qué período)
 * no se veía sin bajar a los filtros. Acá el título manda, el contexto va en
 * píldoras a la vista y las acciones quedan a la derecha.
 *
 * Vive en el módulo compartido para que el Ejecutivo y el PM no se separen
 * visualmente con el tiempo.
 */
export function DashboardHeader({
  icon: Icon,
  titulo,
  subtitulo,
  chips = [],
  acciones,
}: {
  icon: React.ComponentType<{ className?: string }>;
  titulo: string;
  subtitulo: string;
  /** Contexto activo: cartera, período, última actualización. */
  chips?: React.ReactNode[];
  acciones?: React.ReactNode;
}) {
  return (
    <header className="relative overflow-hidden rounded-2xl border border-[#4FAEB2]/25 bg-gradient-to-r from-[#4FAEB2]/[0.12] via-[#4FAEB2]/[0.04] to-transparent px-4 py-4 sm:px-5">
      {/* Halo decorativo. `pointer-events-none` para que no coma clics. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-12 h-44 w-44 rounded-full bg-[#4FAEB2]/15 blur-3xl"
      />
      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#4FAEB2] text-white shadow-sm shadow-[#4FAEB2]/40">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-[24px] font-bold leading-tight tracking-tight text-slate-800">{titulo}</h1>
            <p className="text-[12.5px] text-slate-500">{subtitulo}</p>
            {chips.length > 0 ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {chips.map((c, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-[#4FAEB2]/25 bg-white/70 px-2.5 py-0.5 text-[11px] font-medium text-[#2F6E71]"
                  >
                    {c}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        {acciones ? <div className="flex shrink-0 items-center gap-2">{acciones}</div> : null}
      </div>
    </header>
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
