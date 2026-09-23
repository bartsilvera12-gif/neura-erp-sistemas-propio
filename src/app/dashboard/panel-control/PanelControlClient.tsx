"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  ChevronRight,
  LayoutGrid,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import BlurText from "@/components/reactbits/BlurText";
import CountUp from "@/components/reactbits/CountUp";
import SpotlightCard from "@/components/reactbits/SpotlightCard";
import {
  esSaludConError,
  NOMBRE_SERVIDOR,
  type EstadoContenedor,
  type RespuestaSaludInfra,
  type SaludServidor,
  type SaludServidorItem,
} from "@/lib/infra/salud-tipos";

/**
 * Estado de infraestructura: las tres máquinas de un vistazo.
 *
 * Se lee cada 30 segundos. El colector reescribe los archivos cada minuto, así
 * que el número que se ve nunca tiene más de un minuto y medio de atraso; si un
 * archivo deja de actualizarse (colector caído), la tarjeta se pone en gris en
 * vez de mostrar datos viejos como si fueran de ahora.
 */

const REFRESCO_MS = 30_000;
/** Pasado este tiempo sin archivo nuevo, el dato ya no es de fiar. */
const VIEJO_SEG = 180;

type Semaforo = "verde" | "amarillo" | "rojo" | "gris";

const COLOR_BARRA: Record<Exclude<Semaforo, "gris">, string> = {
  verde: "bg-emerald-500",
  amarillo: "bg-amber-500",
  rojo: "bg-rose-500",
};

const BADGE: Record<Semaforo, { texto: string; clase: string }> = {
  verde: { texto: "Todo bien", clase: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  amarillo: { texto: "Atención", clase: "bg-amber-50 text-amber-700 border-amber-200" },
  rojo: { texto: "Con problema", clase: "bg-rose-50 text-rose-700 border-rose-200" },
  gris: { texto: "Sin datos", clase: "bg-slate-100 text-slate-500 border-slate-200" },
};

/** Nombres técnicos → nombres que se entienden. Lo que no está, se muestra igual. */
const NOMBRE_SERVICIO: Record<string, string> = {
  "supabase-db": "PostgreSQL",
  "supabase-rest": "API",
  "supabase-auth": "Auth",
  "supabase-storage": "Storage",
  "supabase-kong": "Gateway",
  "supabase-realtime": "Realtime",
  "supabase-meta": "Meta",
  "supabase-analytics": "Analytics",
  "supabase-studio": "Studio",
  "supabase-vector": "Logs",
  "supabase-imgproxy": "Imágenes",
  "supabase-edge-functions": "Functions",
  "supabase-pooler": "Pooler",
};

function nombreLindo(name: string): string {
  const n = (name ?? "").trim();
  if (!n) return "—";
  if (NOMBRE_SERVICIO[n]) return NOMBRE_SERVICIO[n];
  // Los ERPs de Coolify se llaman todos "neura-erp-<cliente>": el prefijo no aporta.
  return n.startsWith("neura-erp-") ? n.slice("neura-erp-".length) : n;
}

/** Número usable o null: un campo que falta se muestra "—", no rompe la pantalla. */
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v)}%`;
}

function gb(mb: number | null): string {
  if (mb === null) return "—";
  return `${(mb / 1024).toFixed(1)} GB`;
}

/** Cuánto liberó la limpieza: en GB si pasa el giga, si no en MB. */
function liberado(mb: number | null): string {
  if (mb === null) return "—";
  if (mb === 0) return "liberó 0 (no había nada que limpiar)";
  return mb >= 1024 ? `liberó ${(mb / 1024).toFixed(1)} GB` : `liberó ${Math.round(mb)} MB`;
}

function hace(tsSeg: number | null, now: number): string {
  if (tsSeg === null) return "—";
  const s = Math.max(0, now - tsSeg);
  if (s < 60) return "recién";
  const min = Math.round(s / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} ${d === 1 ? "día" : "días"}`;
}

function horaCorta(d: Date): string {
  return d.toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Un contenedor cuenta como incidente si no está corriendo o si se reporta enfermo. */
function contenedorCaido(c: EstadoContenedor): boolean {
  const state = (c.state ?? "").toLowerCase();
  const health = (c.health ?? "").toLowerCase();
  return state !== "running" || health === "unhealthy";
}

function contenedorSemaforo(c: EstadoContenedor): Semaforo {
  const state = (c.state ?? "").toLowerCase();
  const health = (c.health ?? "").toLowerCase();
  if (state !== "running" || health === "unhealthy") return "rojo";
  // "starting" = todavía levantando; "none" = sin healthcheck, que NO es problema.
  if (health === "starting") return "amarillo";
  return "verde";
}

function ramPct(s: SaludServidor): number | null {
  const total = num(s.ram?.total_mb);
  const usado = num(s.ram?.used_mb);
  if (total === null || usado === null || total <= 0) return null;
  return (usado / total) * 100;
}

/** Semáforo del servidor: manda el peor de los cuatro números y de los sistemas. */
function semaforoServidor(s: SaludServidor, desactualizado: boolean): Semaforo {
  if (desactualizado) return "gris";
  const containers = Array.isArray(s.containers) ? s.containers : [];
  const disco = num(s.disk?.pct);
  if (containers.some(contenedorCaido) || (disco !== null && disco >= 85)) return "rojo";
  const swap = num(s.swap?.pct);
  const ram = ramPct(s);
  const cpu = num(s.load?.cpu_pct);
  if ((swap !== null && swap >= 70) || (ram !== null && ram >= 70) || (cpu !== null && cpu >= 90)) {
    return "amarillo";
  }
  return "verde";
}

function tonoPorUmbral(valor: number | null, amarillo: number, rojo: number): Exclude<Semaforo, "gris"> {
  if (valor === null) return "verde";
  if (valor >= rojo) return "rojo";
  if (valor >= amarillo) return "amarillo";
  return "verde";
}

function Barra({
  etiqueta,
  valor,
  texto,
  tono,
  apagado,
}: {
  etiqueta: string;
  valor: number | null;
  texto: string;
  tono: Exclude<Semaforo, "gris">;
  apagado: boolean;
}) {
  const ancho = valor === null ? 0 : Math.min(100, Math.max(0, valor));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{etiqueta}</span>
        <span className="truncate text-xs text-slate-500">{texto}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${apagado ? "bg-slate-300" : COLOR_BARRA[tono]}`}
          style={{ width: `${ancho}%` }}
        />
      </div>
    </div>
  );
}

/** Para buscar sin pelearse con acentos ni mayúsculas. */
function normalizar(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** El puntito de estado con su halo: 3 px del mismo color, bien tenue. */
function PuntoEstado({ tono }: { tono: Semaforo }) {
  const color = tono === "rojo" ? "225, 29, 72" : tono === "amarillo" ? "245, 158, 11" : "16, 185, 129";
  return (
    <span
      aria-hidden
      className="h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: `rgb(${color})`, boxShadow: `0 0 0 3px rgba(${color}, 0.13)` }}
    />
  );
}

function TileServicio({ c }: { c: EstadoContenedor }) {
  const tono = contenedorSemaforo(c);
  const caido = tono === "rojo";
  return (
    <li
      className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 ${
        caido ? "border-rose-100 bg-rose-50/70" : "border-slate-200 bg-white"
      }`}
    >
      <PuntoEstado tono={tono} />
      <div className="min-w-0 flex-1">
        <p className={`truncate text-[13.5px] font-medium ${caido ? "text-rose-800" : "text-slate-700"}`}>
          {nombreLindo(c.name)}
        </p>
        {c.domain ? <p className="truncate text-[11px] text-slate-400">{c.domain}</p> : null}
      </div>
      <span className={`shrink-0 text-[11px] font-medium ${caido ? "text-rose-600" : "text-slate-400"}`}>
        {caido ? "caído" : tono === "amarillo" ? "levantando" : "activo"}
      </span>
    </li>
  );
}

/** Separador fino con etiqueta, para partir la lista en dos grupos. */
function SeparadorGrupo({ texto, tono }: { texto: string; tono: "rojo" | "neutro" }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${
          tono === "rojo" ? "text-rose-600" : "text-slate-400"
        }`}
      >
        {texto}
      </span>
      <span className={`h-px flex-1 ${tono === "rojo" ? "bg-rose-100" : "bg-slate-100"}`} />
    </div>
  );
}

/**
 * Todos los servicios de una máquina, en un diálogo aparte. Producción tiene
 * ~68: dentro de la tarjeta era una lista con scroll imposible de leer. Acá
 * entran de a dos por fila, lo que falla arriba y el resto abajo.
 */
function ModalSistemas({
  titulo,
  containers,
  onClose,
}: {
  titulo: string;
  containers: EstadoContenedor[];
  onClose: () => void;
}) {
  const [busqueda, setBusqueda] = useState("");
  const cajaRef = useRef<HTMLDivElement>(null);
  const reducirMovimiento = useReducedMotion();

  useEffect(() => {
    // Esc cierra; Tab no se escapa del diálogo (queda dando vueltas adentro).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const caja = cajaRef.current;
      if (!caja) return;
      const focuseables = caja.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focuseables.length === 0) return;
      const primero = focuseables[0];
      const ultimo = focuseables[focuseables.length - 1];
      if (e.shiftKey && document.activeElement === primero) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // El foco entra al diálogo; el fondo no se mueve mientras está abierto.
  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cajaRef.current?.querySelector<HTMLElement>("input, button")?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previo?.focus?.();
    };
  }, []);

  const q = normalizar(busqueda);
  const porNombre = (a: EstadoContenedor, b: EstadoContenedor) =>
    nombreLindo(a.name).localeCompare(nombreLindo(b.name), "es");
  const filtrados = q
    ? containers.filter((c) =>
        normalizar(`${nombreLindo(c.name)} ${c.name ?? ""} ${c.domain ?? ""}`).includes(q)
      )
    : containers;
  const conProblema = filtrados.filter(contenedorCaido).sort(porNombre);
  const sanos = filtrados.filter((c) => !contenedorCaido(c)).sort(porNombre);
  const totalCaidos = containers.filter(contenedorCaido).length;

  // El diálogo sólo existe tras un click, así que el DOM ya está; igual se
  // comprueba por si alguna vez se renderiza en el servidor.
  if (typeof document === "undefined") return null;

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]"
      role="presentation"
      onClick={onClose}
      initial={reducirMovimiento ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
    >
      <motion.div
        ref={cajaRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Sistemas y servicios de ${titulo}`}
        className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        initial={reducirMovimiento ? false : { opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={reducirMovimiento ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
      >
        <header className="flex items-start gap-3 border-b border-slate-100 px-6 py-5">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[17px] font-bold text-slate-900">{titulo}</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              {containers.length} servicios · {containers.length - totalCaidos} funcionando
              {totalCaidos > 0 ? ` · ${totalCaidos} con problema` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="-mr-1.5 -mt-1 shrink-0 rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="border-b border-slate-100 px-6 py-3">
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
            />
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar sistema o dominio…"
              aria-label={`Buscar sistema en ${titulo}`}
              className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-[13.5px] text-slate-700 outline-none placeholder:text-slate-400 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {filtrados.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">Ningún sistema se llama así.</p>
          ) : (
            <div className="space-y-6">
              {conProblema.length > 0 ? (
                <section className="space-y-3">
                  <SeparadorGrupo texto="Requieren atención" tono="rojo" />
                  <ul className="grid gap-2.5 sm:grid-cols-2">
                    {conProblema.map((c, i) => (
                      <TileServicio key={`mal-${c.name}-${i}`} c={c} />
                    ))}
                  </ul>
                </section>
              ) : null}

              {sanos.length > 0 ? (
                <section className="space-y-3">
                  <SeparadorGrupo texto="Funcionando" tono="neutro" />
                  <ul className="grid gap-2.5 sm:grid-cols-2">
                    {sanos.map((c, i) => (
                      <TileServicio key={`ok-${c.name}-${i}`} c={c} />
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}

function TarjetaServidor({ item, now }: { item: SaludServidorItem; now: number }) {
  const [abierto, setAbierto] = useState(false);
  const titulo = NOMBRE_SERVIDOR[item.server] ?? item.server;

  if (esSaludConError(item)) {
    return (
      <SpotlightCard
        spotlightColor="rgba(100, 116, 139, 0.10)"
        className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-bold text-slate-500">{titulo}</h2>
          <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${BADGE.gris.clase}`}>
            {BADGE.gris.texto}
          </span>
        </div>
        <p className="mt-3 text-sm text-slate-500">
          No se pudo leer el informe de esta máquina.
        </p>
      </SpotlightCard>
    );
  }

  const s = item as SaludServidor;
  const ts = num(s.ts);
  const desactualizado = ts === null || now - ts > VIEJO_SEG;
  const estado = semaforoServidor(s, desactualizado);
  const badge = BADGE[estado];

  const cpu = num(s.load?.cpu_pct);
  const ram = ramPct(s);
  const ramUsado = num(s.ram?.used_mb);
  const ramTotal = num(s.ram?.total_mb);
  const disco = num(s.disk?.pct);
  const swapTotal = num(s.swap?.total_mb);
  const swap = num(s.swap?.pct);
  const sinSwap = swapTotal === 0;

  const containers = Array.isArray(s.containers) ? s.containers : [];
  const caidos = containers.filter(contenedorCaido);
  const cleanup = s.cleanup;

  const detalleCaidos =
    caidos.length === 0
      ? ""
      : caidos.length <= 2
        ? caidos.map((c) => nombreLindo(c.name)).join(" y ")
        : `${nombreLindo(caidos[0].name)} y ${caidos.length - 1} más`;

  return (
    <SpotlightCard
      spotlightColor={
        desactualizado
          ? "rgba(100, 116, 139, 0.08)"
          : estado === "rojo"
            ? "rgba(225, 29, 72, 0.10)"
            : estado === "amarillo"
              ? "rgba(245, 158, 11, 0.10)"
              : "rgba(79, 174, 178, 0.12)"
      }
      className={`rounded-2xl border bg-white p-5 shadow-sm ${
        desactualizado ? "border-slate-200 opacity-70" : estado === "rojo" ? "border-rose-200" : "border-slate-200"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className={`text-base font-bold ${desactualizado ? "text-slate-500" : "text-slate-800"}`}>{titulo}</h2>
        <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${badge.clase}`}>
          {badge.texto}
        </span>
      </div>

      {desactualizado ? (
        <p className="mt-1 text-xs font-medium text-slate-500">
          Sin datos {hace(ts, now)}
        </p>
      ) : (
        <p className="mt-1 text-xs text-slate-400">Medido {hace(ts, now)}</p>
      )}

      <div className="mt-4 space-y-3">
        <Barra
          etiqueta="CPU"
          valor={cpu}
          texto={`${pct(cpu)} · valor del momento`}
          tono={tonoPorUmbral(cpu, 70, 90)}
          apagado={desactualizado}
        />
        <Barra
          etiqueta="Memoria"
          valor={ram}
          texto={ramUsado === null || ramTotal === null ? "—" : `${gb(ramUsado)} / ${gb(ramTotal)} · ${pct(ram)}`}
          tono={tonoPorUmbral(ram, 70, 85)}
          apagado={desactualizado}
        />
        <Barra
          etiqueta="Disco"
          valor={disco}
          texto={pct(disco)}
          tono={tonoPorUmbral(disco, 70, 85)}
          apagado={desactualizado}
        />
        <Barra
          etiqueta="Swap"
          valor={sinSwap ? 0 : swap}
          texto={sinSwap ? "sin swap" : pct(swap)}
          tono={sinSwap ? "verde" : tonoPorUmbral(swap, 50, 70)}
          apagado={desactualizado}
        />
      </div>

      <div className="mt-4 border-t border-slate-100 pt-3">
        {containers.length === 0 ? (
          <p className="text-sm text-slate-400">Sin sistemas de clientes</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <p className={`text-sm font-medium ${caidos.length > 0 ? "text-rose-700" : "text-emerald-700"}`}>
                {caidos.length > 0
                  ? `${containers.length} servicios · ${detalleCaidos} caído`
                  : `${containers.length} sistemas · todos arriba`}
              </p>
              <button
                type="button"
                onClick={() => setAbierto(true)}
                className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
                aria-haspopup="dialog"
              >
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                Ver sistemas
              </button>
            </div>

            <AnimatePresence>
              {abierto ? (
                <ModalSistemas
                  titulo={titulo}
                  containers={containers}
                  onClose={() => setAbierto(false)}
                />
              ) : null}
            </AnimatePresence>
          </>
        )}
      </div>

      <div className="mt-3 border-t border-slate-100 pt-3">
        <p className="text-xs text-slate-500">
          {cleanup
            ? `Última limpieza: ${hace(num(cleanup.ts), now)} · ${liberado(num(cleanup.freed_mb))}`
            : "Sin limpieza registrada"}
        </p>
      </div>
    </SpotlightCard>
  );
}

/**
 * Una celda de la franja de resumen: ícono y etiqueta chica arriba, el dato
 * abajo. Mismo patrón que la franja del ticket de Soporte — una sola tarjeta
 * partida por líneas finas en vez de cuatro recuadros sueltos.
 */
function Resumen({
  icono: Icono,
  etiqueta,
  numero,
  texto,
  sub,
  alerta,
}: {
  icono: LucideIcon;
  etiqueta: string;
  numero?: number;
  texto?: string;
  sub?: string;
  alerta?: boolean;
}) {
  return (
    <div className="min-w-0 bg-white px-5 py-4">
      <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-slate-400">
        <Icono className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
        {etiqueta}
      </p>
      <div
        className={`mt-1 flex items-center gap-2 text-[22px] font-bold leading-tight tracking-tight tabular-nums ${
          alerta ? "text-rose-600" : "text-slate-800"
        }`}
      >
        {alerta ? <PuntoEstado tono="rojo" /> : null}
        <span className="truncate">
          {typeof numero === "number" ? <CountUp key={numero} to={numero} duration={0.9} /> : (texto ?? "—")}
        </span>
      </div>
      {sub ? (
        <p className={`mt-0.5 truncate text-[12px] ${alerta ? "text-rose-500" : "text-slate-400"}`}>{sub}</p>
      ) : null}
    </div>
  );
}

export default function PanelControlClient() {
  const [datos, setDatos] = useState<RespuestaSaludInfra | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [ultima, setUltima] = useState<Date | null>(null);
  /**
   * Mientras se pide, el botón gira y queda deshabilitado. Sin esto el click
   * no se nota: el colector escribe una vez por minuto, así que los números
   * suelen volver idénticos y la pantalla parece no hacer nada.
   */
  const [refrescando, setRefrescando] = useState(false);
  const vivoRef = useRef(true);

  const cargar = useCallback(async () => {
    setRefrescando(true);
    try {
      const res = await fetchWithSupabaseSession("/api/infra-health", { cache: "no-store" });
      if (!vivoRef.current) return;
      if (res.status === 401 || res.status === 403) {
        setError("Esta pantalla es sólo para los usuarios habilitados.");
        setCargando(false);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as RespuestaSaludInfra;
      if (!vivoRef.current) return;
      if (!Array.isArray(j?.servers)) throw new Error("respuesta inesperada");
      setDatos(j);
      setUltima(new Date());
      setError(null);
    } catch {
      if (!vivoRef.current) return;
      // Si ya había datos, se dejan en pantalla: mejor un número de hace un
      // minuto que una pantalla en blanco.
      setError("No se pudo leer el estado de los servidores. Se reintenta solo.");
    } finally {
      // Piso de medio segundo: una respuesta de 40 ms haría un parpadeo que no
      // se ve, y el click volvería a parecer ignorado.
      await new Promise((r) => setTimeout(r, 500));
      if (vivoRef.current) {
        setCargando(false);
        setRefrescando(false);
      }
    }
  }, []);

  useEffect(() => {
    vivoRef.current = true;
    void cargar();
    const id = setInterval(() => void cargar(), REFRESCO_MS);
    return () => {
      vivoRef.current = false;
      clearInterval(id);
    };
  }, [cargar]);

  const resumen = useMemo(() => {
    const servers = datos?.servers ?? [];
    const now = datos?.now ?? Math.floor(Date.now() / 1000);
    let sistemas = 0;
    let incidentes = 0;
    let conProblema = 0;
    let sinDatos = 0;
    let limpieza: { ts: number; freed: number | null } | null = null;

    for (const item of servers) {
      if (esSaludConError(item)) {
        sinDatos += 1;
        continue;
      }
      const s = item as SaludServidor;
      const ts = num(s.ts);
      const viejo = ts === null || now - ts > VIEJO_SEG;
      if (viejo) sinDatos += 1;
      const containers = Array.isArray(s.containers) ? s.containers : [];
      sistemas += containers.length;
      incidentes += containers.filter(contenedorCaido).length;
      if (semaforoServidor(s, viejo) === "rojo") conProblema += 1;
      const cts = num(s.cleanup?.ts ?? null);
      if (cts !== null && (limpieza === null || cts > limpieza.ts)) {
        limpieza = { ts: cts, freed: num(s.cleanup?.freed_mb ?? null) };
      }
    }
    return { now, maquinas: servers.length, sistemas, incidentes, conProblema, sinDatos, limpieza };
  }, [datos]);

  const subMaquinas = (() => {
    const partes: string[] = [];
    if (resumen.conProblema > 0) partes.push(`${resumen.conProblema} con problema`);
    if (resumen.sinDatos > 0) partes.push(`${resumen.sinDatos} sin datos`);
    return partes.length > 0 ? partes.join(" · ") : "todas bien";
  })();

  if (cargando && !datos) {
    return (
      <div className="p-4 md:p-6">
        <div className="h-6 w-56 animate-pulse rounded bg-slate-200" />
        <div className="mt-6 h-[92px] animate-pulse rounded-2xl bg-slate-100" />
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-80 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {/* BlurText renderiza un <p>, así que el título real va aparte y oculto:
              se lee igual con lector de pantalla y el H1 de la página no se pierde. */}
          <h1 className="sr-only">Estado de infraestructura</h1>
          <BlurText
            text="Estado de infraestructura"
            animateBy="words"
            delay={60}
            className="text-xl font-bold text-slate-900"
          />
          <p className="mt-0.5 text-sm text-slate-500">Se actualiza cada 30 segundos</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            En vivo
          </span>
          <span className="text-xs text-slate-400">
            {refrescando
              ? "Actualizando…"
              : ultima
                ? `Última actualización ${horaCorta(ultima)}`
                : "—"}
          </span>
          <button
            type="button"
            onClick={() => void cargar()}
            disabled={refrescando}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refrescando ? "animate-spin" : ""}`} />
            {refrescando ? "Actualizando" : "Actualizar"}
          </button>
        </div>
      </header>

      {error ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <section className="mt-5 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-100 shadow-[0_1px_3px_rgba(15,23,42,0.05),0_8px_24px_-12px_rgba(15,23,42,0.08)] sm:grid-cols-2 lg:grid-cols-4">
        <Resumen
          icono={Server}
          etiqueta="Máquinas"
          numero={resumen.maquinas}
          sub={subMaquinas}
          alerta={resumen.conProblema > 0}
        />
        <Resumen
          icono={LayoutGrid}
          etiqueta="Sistemas y servicios"
          numero={resumen.sistemas}
          sub="en las tres máquinas"
        />
        <Resumen
          icono={resumen.incidentes > 0 ? AlertTriangle : ShieldCheck}
          etiqueta="Incidentes activos"
          numero={resumen.incidentes}
          sub={resumen.incidentes > 0 ? "hay algo caído" : "nada caído"}
          alerta={resumen.incidentes > 0}
        />
        <Resumen
          icono={Trash2}
          etiqueta="Última limpieza global"
          texto={resumen.limpieza ? hace(resumen.limpieza.ts, resumen.now) : "—"}
          sub={resumen.limpieza ? liberado(resumen.limpieza.freed) : "Sin limpieza registrada"}
        />
      </section>

      {datos ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {datos.servers.map((s) => (
            <TarjetaServidor key={s.server} item={s} now={datos.now} />
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-8 text-center">
          <Sparkles aria-hidden className="mx-auto h-5 w-5 text-slate-300" />
          <p className="mt-2 text-sm text-slate-500">Todavía no hay datos para mostrar.</p>
        </div>
      )}
    </div>
  );
}
