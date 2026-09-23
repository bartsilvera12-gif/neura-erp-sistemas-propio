"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, RefreshCw, Sparkles } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
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

function TarjetaServidor({ item, now }: { item: SaludServidorItem; now: number }) {
  const [abierto, setAbierto] = useState(false);
  const titulo = NOMBRE_SERVIDOR[item.server] ?? item.server;

  if (esSaludConError(item)) {
    return (
      <section className="rounded-xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-bold text-slate-500">{titulo}</h2>
          <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${BADGE.gris.clase}`}>
            {BADGE.gris.texto}
          </span>
        </div>
        <p className="mt-3 text-sm text-slate-500">
          No se pudo leer el informe de esta máquina.
        </p>
      </section>
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
    <section
      className={`rounded-xl border bg-white p-5 shadow-sm ${
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
                onClick={() => setAbierto((v) => !v)}
                className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
                aria-expanded={abierto}
              >
                {abierto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Ver sistemas
              </button>
            </div>

            {abierto ? (
              <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto pr-1">
                {containers.map((c, i) => {
                  const tono = contenedorSemaforo(c);
                  return (
                    <li key={`${c.name}-${i}`} className="flex items-start gap-2 py-0.5">
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                          tono === "rojo" ? "bg-rose-500" : tono === "amarillo" ? "bg-amber-500" : "bg-emerald-500"
                        }`}
                        aria-hidden
                      />
                      <div className="min-w-0">
                        <p className="truncate text-[13px] text-slate-700">{nombreLindo(c.name)}</p>
                        {c.domain ? <p className="truncate text-[11px] text-slate-400">{c.domain}</p> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
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
    </section>
  );
}

function Kpi({
  label,
  value,
  sub,
  alerta,
}: {
  label: string;
  value: string;
  sub?: string;
  alerta?: boolean;
}) {
  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm ${alerta ? "border-rose-200" : "border-slate-200"}`}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-lg font-bold ${alerta ? "text-rose-700" : "text-slate-800"}`}>{value}</div>
      {sub ? <div className={`mt-0.5 text-xs ${alerta ? "text-rose-600" : "text-slate-400"}`}>{sub}</div> : null}
    </div>
  );
}

export default function PanelControlClient() {
  const [datos, setDatos] = useState<RespuestaSaludInfra | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [ultima, setUltima] = useState<Date | null>(null);
  const vivoRef = useRef(true);

  const cargar = useCallback(async () => {
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
      if (vivoRef.current) setCargando(false);
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
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-80 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Estado de infraestructura</h1>
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
            {ultima ? `Última actualización ${horaCorta(ultima)}` : "—"}
          </span>
          <button
            type="button"
            onClick={() => void cargar()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Actualizar
          </button>
        </div>
      </header>

      {error ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Máquinas" value={String(resumen.maquinas)} sub={subMaquinas} alerta={resumen.conProblema > 0} />
        <Kpi label="Sistemas y servicios" value={String(resumen.sistemas)} sub="en las tres máquinas" />
        <Kpi
          label="Incidentes activos"
          value={String(resumen.incidentes)}
          sub={resumen.incidentes > 0 ? "hay algo caído" : "nada caído"}
          alerta={resumen.incidentes > 0}
        />
        <Kpi
          label="Última limpieza global"
          value={resumen.limpieza ? hace(resumen.limpieza.ts, resumen.now) : "—"}
          sub={resumen.limpieza ? liberado(resumen.limpieza.freed) : "Sin limpieza registrada"}
        />
      </div>

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
