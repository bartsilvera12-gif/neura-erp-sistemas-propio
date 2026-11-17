"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Bot, Wallet, CheckCircle2, Timer, RotateCcw, Repeat2, Flame, Server, Activity, Download, Loader2, CalendarDays, X, ChevronDown } from "lucide-react";
import { apiSoporte } from "../_ui/api";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { Aviso, Cargando, Encabezado, Pagina, Tarjeta, Vacio, claseBoton } from "../_ui/ui";

type Ficha = { id: string | null; numero: number; asunto: string; cliente: string | null; estado_codigo: string | null; usd: number; vueltas: number };

type Resp = {
  agente: { id: string; nombre: string } | null;
  rango: { desde: string | null; hasta: string | null; activo: boolean; diasGrafico: number };
  gasto: { hoy: number; mes: number; total: number; topeMes: number; vueltasHoy: number; periodo: number; vueltasPeriodo: number };
  trabajo: {
    resueltos: number;
    abiertos: number;
    costoPorTicket: number | null;
    medianaMinutos: number | null;
    vueltasMediana: number | null;
    volvieron: number;
    ticketsConGasto: number;
  };
  hoy: Ficha[];
  dias: { fecha: string; usd: number; vueltas: number }[];
  capas: { nombre: string; valores: number[] }[];
  sistemas: { nombre: string; usd: number; vueltas: number; tickets: number }[];
  volvieronLista: Ficha[];
  abiertos: (Ficha & { desde: string })[];
  caros: Ficha[];
  resueltos: (Ficha & { resuelto_at: string; volvio: boolean })[];
};

const usd = (n: number) => `US$ ${n.toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nro = (n: number) => `#${String(n).padStart(4, "0")}`;

/** 95 → "1 h 35 min". Los minutos sueltos no se leen cuando pasan de la hora. */
function duracion(min: number | null): string {
  if (min == null) return "—";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "2026-11-11" → "11/11". Dos dígitos alcanzan para un eje de catorce días. */
const diaCorto = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;

function desdeHace(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const min = ms / 60_000;
  if (min < 60) return `hace ${Math.round(min)} min`;
  const h = min / 60;
  if (h < 48) return `hace ${Math.round(h)} h`;
  return `hace ${Math.round(h / 24)} días`;
}

function Dato({ etiqueta, valor, pie, icono: Icono, tono = "text-slate-400" }: { etiqueta: string; valor: string; pie?: string; icono: typeof Wallet; tono?: string }) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="mb-2 flex items-center gap-2">
        <Icono className={`h-4 w-4 ${tono}`} aria-hidden />
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{etiqueta}</p>
      </div>
      <p className="text-[22px] font-semibold leading-none text-slate-800">{valor}</p>
      {pie ? <p className="mt-1.5 text-[12px] leading-snug text-slate-400">{pie}</p> : null}
    </div>
  );
}

/** Ticket con su número, asunto y cliente: la fila que se repite en todas las listas. */
function FilaTicket({ t, extra }: { t: Ficha; extra?: React.ReactNode }) {
  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="px-5 py-3">
        {t.id ? (
          <Link href={`/dashboard/soporte/tickets/${t.id}`} className="font-semibold text-[#2F7F83] hover:underline">
            {nro(t.numero)}
          </Link>
        ) : (
          <span className="font-semibold text-slate-400">{nro(t.numero)}</span>
        )}
        <p className="mt-0.5 line-clamp-1 text-[12px] text-slate-500">{t.asunto}</p>
        {t.cliente ? <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-400">{t.cliente}</p> : null}
      </td>
      {extra}
    </tr>
  );
}

/** Paleta de la torta: los mismos tonos que usa el resto de Soporte. */
/**
 * Un color por porción, generado con el ángulo áureo: cada tono queda lejos
 * del anterior, así que nunca se repiten ni con cuarenta sistemas. Una lista
 * fija de colores se agotaba y dejaba porciones vecinas del mismo tono.
 */
/**
 * Paleta de la torta: doce tonos elegidos a mano, alternando cálido y frío
 * para que dos porciones vecinas nunca se parezcan. Rotar el tono por fórmula
 * daba combinaciones chillonas (magenta al lado de lima).
 *
 * Con más de doce sistemas se repite la base cambiando el brillo, que sigue
 * leyéndose como una familia en vez de como colores sueltos.
 */
const PALETA: [number, number, number][] = [
  [214, 82, 58], // azul
  [45, 92, 60],  // amarillo
  [24, 90, 58],  // naranja
  [350, 72, 54], // rojo
  [118, 48, 52], // verde
  [262, 60, 64], // violeta
  [190, 70, 50], // turquesa
  [330, 65, 62], // rosa
  [150, 45, 48], // verde agua
  [30, 55, 60],  // arena
  [285, 45, 60], // lila
  [200, 55, 62], // celeste
];

/**
 * Los doce primeros (los que pesan) van a color pleno. De ahí en más son
 * porciones de menos del 3%: se repiten los mismos tonos pero lavados, para
 * que la cola no compita con lo que importa. Oscurecerlos, como antes,
 * ensuciaba la torta entera.
 */
function tonos(i: number) {
  const [h, sat, l] = PALETA[i % PALETA.length];
  const cola = Math.floor(i / PALETA.length);
  if (!cola) return { s: sat, l };
  return { s: Math.round(sat * 0.38), l: Math.min(84, l + 12 + cola * 3) };
}
const colorPorcion = (i: number) => {
  const { s: sat, l } = tonos(i);
  return `hsl(${PALETA[i % PALETA.length][0]} ${sat}% ${l}%)`;
};
/** La cara del corte, a mitad de camino entre la tapa y la pared. */
const colorCorte = (i: number) => {
  const { s: sat, l } = tonos(i);
  return `hsl(${PALETA[i % PALETA.length][0]} ${sat}% ${Math.max(24, l - 9)}%)`;
};
/** El costado va más oscuro: es lo que da la sensación de volumen. */
const colorPared = (i: number) => {
  const { s: sat, l } = tonos(i);
  return `hsl(${PALETA[i % PALETA.length][0]} ${sat}% ${Math.max(20, l - 17)}%)`;
};

/**
 * Las cargas a mano (el gasto previo a la tabla) llegan con un texto largo
 * como nombre de sistema. En la torta se juntan en una sola porción.
 */
const nombreCorto = (n: string) => (/^carga inicial/i.test(n) ? "Carga inicial" : n.replace(/^neura-erp-/, ""));

/**
 * Torta con volumen: la tapa es un círculo achatado (elipse) y el costado una
 * pared extruida hacia abajo. Sin librería de gráficos: es geometría y SVG.
 */
/**
 * Dona 3D. Se arma acostada —tapa en elipse, espesor hacia abajo— y después se
 * gira entera con GIRO: queda de frente, apenas girada para que asome el espesor
 * de un costado.
 *
 * Qué se ve de cada porción depende de dónde cae en ese marco acostado:
 *  - la pared de AFUERA, solo en la mitad de adelante;
 *  - la pared de ADENTRO, solo en la mitad de atrás, a través del agujero.
 * Lo demás queda tapado y no se dibuja.
 */
const DONA = { R: 82, r: 52, K: 0.8, D: 18, GIRO: -90, INICIO: 0.38 };
/**
 * Cuánto se despega una porción al pasarle el cursor. De frente, "subirla"
 * deja un hueco y se ve roto: lo natural es que se aleje del centro.
 */
const SEPARA = 6;
/** La dirección hacia afuera de una porción. En el marco acostado ya es radial. */
function hacia(t0: number, t1: number) {
  const a = 2 * Math.PI * ((t0 + t1) / 2) - Math.PI / 2;
  return { x: SEPARA * Math.cos(a), y: SEPARA * DONA.K * Math.sin(a) };
}

const enAro = (t: number, rad: number, dy = 0) => {
  const a = 2 * Math.PI * t - Math.PI / 2;
  return { x: rad * Math.cos(a), y: rad * DONA.K * Math.sin(a) + dy };
};
const n2 = (v: number) => v.toFixed(2);

/** La tapa de una porción: un trozo de aro. */
function tapaAro(t0: number, t1: number): string {
  if (t1 - t0 >= 0.999) return `${tapaAro(t0, t0 + 0.5)} ${tapaAro(t0 + 0.5, t1 - 0.0001)}`;
  const { R, r, K } = DONA;
  const g = t1 - t0 > 0.5 ? 1 : 0;
  const a = enAro(t0, R), b = enAro(t1, R), c = enAro(t1, r), d = enAro(t0, r);
  return `M ${n2(a.x)} ${n2(a.y)} A ${R} ${R * K} 0 ${g} 1 ${n2(b.x)} ${n2(b.y)} L ${n2(c.x)} ${n2(c.y)} A ${r} ${r * K} 0 ${g} 0 ${n2(d.x)} ${n2(d.y)} Z`;
}

/** Recorta [t0, t1] a las ventanas dadas, contemplando que los ángulos pasan de 1. */
function tramos(t0: number, t1: number, ventanas: [number, number][]) {
  const out: [number, number][] = [];
  for (const k of [-1, 0, 1, 2]) {
    for (const [lo, hi] of ventanas) {
      const i = Math.max(t0, lo + k);
      const e = Math.min(t1, hi + k);
      if (e > i) out.push([i, e]);
    }
  }
  return out;
}

/** Una franja de pared cilíndrica, del borde de la tapa hacia abajo. */
function franja(i: number, e: number, rad: number) {
  const { K, D } = DONA;
  const a = enAro(i, rad), b = enAro(e, rad);
  return `M ${n2(a.x)} ${n2(a.y)} A ${rad} ${rad * K} 0 0 1 ${n2(b.x)} ${n2(b.y)} L ${n2(b.x)} ${n2(b.y + D)} A ${rad} ${rad * K} 0 0 0 ${n2(a.x)} ${n2(a.y + D)} Z`;
}
/**
 * Una cara del corte: el plano que va del borde de adentro al de afuera, con
 * su espesor. Sin estas, una porción despegada es tapa y pared sueltas — se ve
 * como una hoja doblada y se ve "a través".
 */
function caraAro(t: number) {
  const { R, r, D } = DONA;
  const a = enAro(t, r), b = enAro(t, R);
  return `M ${n2(a.x)} ${n2(a.y)} L ${n2(b.x)} ${n2(b.y)} L ${n2(b.x)} ${n2(b.y + D)} L ${n2(a.x)} ${n2(a.y + D)} Z`;
}
/**
 * Una cara del corte se ve solo si apunta hacia la cámara. Dibujar las dos
 * siempre dejaba un "ala" de la cara escondida asomando por el costado.
 * La del final de una pieza mira hacia adelante en el sentido del giro; la del
 * principio, hacia atrás.
 */
const anguloAro = (t: number) => 2 * Math.PI * t - Math.PI / 2;
const seVeFinal = (t: number) => Math.cos(anguloAro(t)) > 0;
const seVeInicio = (t: number) => Math.cos(anguloAro(t)) < 0;

const paredAfuera = (t0: number, t1: number) => tramos(t0, t1, [[0.25, 0.75]]).map(([i, e]) => franja(i, e, DONA.R));
const paredAdentro = (t0: number, t1: number) => tramos(t0, t1, [[-0.25, 0.25]]).map(([i, e]) => franja(i, e, DONA.r));

/** Del marco acostado al de la pantalla: aplica el giro. Para ubicar etiquetas. */
function girado(x: number, y: number) {
  const a = (DONA.GIRO * Math.PI) / 180;
  return { x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) };
}

/* ---------------------------------------------------- gasto por día en 3D */
/** La profundidad va hacia arriba a la derecha; cada serie, una cordillera. */
const G = { ox: 16, oy: 168, ancho: 210, alto: 74, kx: 0.7, ky: -0.46, espesor: 16, paso: 18 };
const punto = (x: number, v: number, z: number, esc: number) =>
  [G.ox + x + z * G.kx, G.oy - v * esc + z * G.ky] as const;
const trazo = (pts: readonly (readonly [number, number])[]) =>
  pts.map(([x, y], i) => `${i ? "L" : "M"} ${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
const vuelta = (pts: readonly (readonly [number, number])[]) => trazo([...pts].reverse()).slice(1);

export default function NeuritaPage() {
  const [d, setD] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bajando, setBajando] = useState(false);
  /** Porción de la torta bajo el cursor: se eleva y se separa del resto. */
  const [porcionActiva, setPorcionActiva] = useState<string | null>(null);
  /**
   * Las listas se muestran recortadas: "Todo lo que resolvió" puede traer
   * cientos de filas y hace la página larguísima. Cada una se despliega sola.
   */
  const TOPE_LISTA = 8;
  const [abiertas, setAbiertas] = useState<Record<string, boolean>>({});
  const recortar = <T,>(clave: string, xs: T[]) => (abiertas[clave] ? xs : xs.slice(0, TOPE_LISTA));
  const VerMas = ({ clave, total }: { clave: string; total: number }) => {
    if (total <= TOPE_LISTA) return null;
    const abierta = !!abiertas[clave];
    return (
      <div className="border-t border-slate-100 px-5 py-2.5">
        <button
          type="button"
          onClick={() => setAbiertas((p) => ({ ...p, [clave]: !p[clave] }))}
          className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#2F7F83] hover:underline"
        >
          {abierta ? "Ver menos" : `Ver las ${total}`}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${abierta ? "rotate-180" : ""}`} aria-hidden />
        </button>
      </div>
    );
  };

  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  /** `?desde=…&hasta=…` o vacío. Lo usan la consulta y la descarga del PDF. */
  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (desde) p.set("desde", desde);
    if (hasta) p.set("hasta", hasta);
    const q = p.toString();
    return q ? `?${q}` : "";
  }, [desde, hasta]);

  /** Día de hoy en hora local, que es la que ve quien usa la pantalla. */
  const diaISO = (resta = 0) => {
    const d = new Date();
    d.setDate(d.getDate() - resta);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const atajo = (dias: number | "mes") => {
    if (dias === "mes") {
      setDesde(diaISO().slice(0, 8) + "01");
      setHasta(diaISO());
      return;
    }
    setDesde(diaISO(dias));
    setHasta(diaISO());
  };

  /**
   * El PDF lo arma el servidor con los mismos datos de la pantalla. Se pide con
   * la sesión (no es una URL pública) y se entrega como descarga.
   */
  const descargar = async () => {
    setBajando(true);
    try {
      const r = await fetchWithSupabaseSession(`/api/soporte/neurita/pdf${query}`, { cache: "no-store" });
      if (!r || !r.ok) throw new Error("No se pudo generar el PDF");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `neurita-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      // Sin revoke, el blob queda en memoria mientras viva la pestaña.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo generar el PDF");
    } finally {
      setBajando(false);
    }
  };

  useEffect(() => {
    let vivo = true;
    const traer = () =>
      apiSoporte<Resp>(`/api/soporte/neurita${query}`)
        .then((r) => {
          if (!vivo) return;
          setD(r);
          setError(null);
        })
        .catch((e) => vivo && setError(e instanceof Error ? e.message : "No se pudo leer"));
    traer();
    const t = setInterval(traer, 60_000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [query]);

  if (error) return <Pagina><Aviso>{error}</Aviso></Pagina>;
  if (!d) return <Pagina><Cargando /></Pagina>;

  const { gasto, trabajo } = d;
  const pctMes = gasto.topeMes > 0 ? Math.min(100, Math.round((gasto.mes / gasto.topeMes) * 100)) : 0;
  const pctVuelta = trabajo.resueltos > 0 ? Math.round((trabajo.volvieron / trabajo.resueltos) * 100) : null;
  const picoDia = Math.max(0.01, ...d.dias.map((x) => x.usd));

  return (
    <Pagina>
      <Encabezado
        titulo={d.agente?.nombre ?? "Neurita"}
        subtitulo="Qué hizo y cuánto costó el agente de IA"
        icono={Bot}
        tono="violeta"
        acciones={
          <button type="button" onClick={descargar} disabled={bajando} className={claseBoton("secundario")}>
            {bajando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
            {bajando ? "Generando…" : "Descargar PDF"}
          </button>
        }
      />

      {/* Filtro de fechas: los atajos cubren el 90% y las dos cajas el resto. */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <CalendarDays className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
        {([["Hoy", 0], ["7 días", 6], ["30 días", 29], ["Este mes", "mes"]] as const).map(([et, v]) => (
          <button
            key={et}
            type="button"
            onClick={() => atajo(v as number | "mes")}
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-[12px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
          >
            {et}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
        <label className="sr-only" htmlFor="neurita-desde">Desde</label>
        <input
          id="neurita-desde"
          type="date"
          value={desde}
          max={hasta || undefined}
          onChange={(e) => setDesde(e.target.value)}
          className="rounded-lg border border-slate-200 px-2 py-1 text-[12px] text-slate-700 outline-none focus:border-[#7DCFD2]"
        />
        <span className="text-[12px] text-slate-400">a</span>
        <label className="sr-only" htmlFor="neurita-hasta">Hasta</label>
        <input
          id="neurita-hasta"
          type="date"
          value={hasta}
          min={desde || undefined}
          onChange={(e) => setHasta(e.target.value)}
          className="rounded-lg border border-slate-200 px-2 py-1 text-[12px] text-slate-700 outline-none focus:border-[#7DCFD2]"
        />
        {(desde || hasta) && (
          <button
            type="button"
            onClick={() => {
              setDesde("");
              setHasta("");
            }}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-3.5 w-3.5" aria-hidden /> Todo el historial
          </button>
        )}
        <span className="ml-auto text-[11px] text-slate-400">
          {d.rango.activo ? "Los números de abajo son del período elegido" : "Sin filtro: todo el historial"}
        </span>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Dato
          etiqueta={d.rango.activo ? "Gasto del período" : "Gastó hoy"}
          valor={usd(d.rango.activo ? gasto.periodo : gasto.hoy)}
          pie={`${d.rango.activo ? gasto.vueltasPeriodo : gasto.vueltasHoy} ${(d.rango.activo ? gasto.vueltasPeriodo : gasto.vueltasHoy) === 1 ? "vuelta" : "vueltas"} del modelo`}
          icono={Wallet}
          tono="text-violet-500"
        />
        <Dato etiqueta="Este mes" valor={usd(gasto.mes)} pie={`${pctMes}% del tope de ${usd(gasto.topeMes)}`} icono={Wallet} tono="text-violet-500" />
        <Dato etiqueta="Total histórico" valor={usd(gasto.total)} pie="no cambia con el filtro" icono={Wallet} />
        <Dato etiqueta="Resueltos" valor={String(trabajo.resueltos)} pie={trabajo.abiertos ? `${trabajo.abiertos} abiertos ahora` : "ninguno abierto"} icono={CheckCircle2} tono="text-emerald-500" />
        <Dato etiqueta="Costo por ticket" valor={trabajo.costoPorTicket == null ? "—" : usd(trabajo.costoPorTicket)} pie="todo lo gastado ÷ resueltos" icono={Wallet} />
        <Dato
          etiqueta="Le volvieron"
          valor={pctVuelta == null ? "—" : `${pctVuelta}%`}
          pie={`${trabajo.volvieron} de ${trabajo.resueltos} se reabrieron`}
          icono={RotateCcw}
          tono={trabajo.volvieron > 0 ? "text-rose-500" : "text-slate-400"}
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Dato etiqueta="Tarda (mediana)" valor={duracion(trabajo.medianaMinutos)} pie="desde que lo toma hasta que lo resuelve" icono={Timer} tono="text-sky-500" />
        <Dato
          etiqueta="Vueltas por ticket (mediana)"
          valor={trabajo.vueltasMediana == null ? "—" : String(trabajo.vueltasMediana)}
          pie={`sobre ${trabajo.ticketsConGasto} ${trabajo.ticketsConGasto === 1 ? "ticket" : "tickets"} con gasto informado`}
          icono={Repeat2}
          tono="text-amber-500"
        />
      </div>

      <Tarjeta
        titulo={d.rango.activo ? `Gasto por día (${d.rango.diasGrafico} días)` : "Gasto de los últimos 14 días"}
        icono={Activity}
        tono="violeta"
        className="mb-5"
      >
        {d.capas.length === 0 || d.dias.length < 2 ? (
          <Vacio titulo="Todavía no hay gasto para graficar" icono={Activity} tono="violeta" />
        ) : (
          (() => {
            const n = d.dias.length;
            const pico = Math.max(0.01, ...d.capas.flatMap((c) => c.valores));
            const esc = G.alto / pico;
            const dx = G.ancho / (n - 1);
            // De atrás hacia adelante: la última serie es la más cercana y tapa
            // a las de atrás, que es lo que arma la profundidad.
            const cordilleras = d.capas.map((c, k) => {
              const z0 = (d.capas.length - 1 - k) * G.paso;
              const z1 = z0 + G.espesor;
              const atras = c.valores.map((v, i) => punto(i * dx, v, z0, esc));
              const frente = c.valores.map((v, i) => punto(i * dx, v, z1, esc));
              const base = c.valores.map((_, i) => punto(i * dx, 0, z1, esc));
              const [h, sat, l] = PALETA[k % PALETA.length];
              const der = [
                punto(G.ancho, 0, z0, esc),
                punto(G.ancho, c.valores[n - 1], z0, esc),
                punto(G.ancho, c.valores[n - 1], z1, esc),
                punto(G.ancho, 0, z1, esc),
              ];
              return {
                nombre: c.nombre,
                z0,
                total: c.valores.reduce((a, b) => a + b, 0),
                pared: `${trazo(frente)} ${vuelta(base)} Z`,
                tapa: `${trazo(atras)} ${vuelta(frente)} Z`,
                lado: `${trazo(der)} Z`,
                cTapa: `hsl(${h} ${sat}% ${l + 6}%)`,
                cPared: `hsl(${h} ${sat}% ${l - 12}%)`,
                cLado: `hsl(${h} ${sat}% ${l - 24}%)`,
              };
            });
            return (
              <div>
                <svg viewBox="0 0 340 200" className="w-full" role="img" aria-label="Gasto por día y por sistema">
                  {[...cordilleras]
                    .sort((a, b) => b.z0 - a.z0)
                    .map((c) => (
                      <g key={c.nombre}>
                        <title>{`${c.nombre}: ${usd(c.total)} en el período`}</title>
                        <path d={c.pared} fill={c.cPared} />
                        <path d={c.tapa} fill={c.cTapa} />
                        <path d={c.lado} fill={c.cLado} />
                      </g>
                    ))}
                </svg>
                <div className="-mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                  <span>{d.dias[0].fecha.slice(8, 10)}/{d.dias[0].fecha.slice(5, 7)}</span>
                  <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1">
                    {cordilleras.map((c) => (
                      <li key={c.nombre} className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: c.cTapa }} aria-hidden />
                        <span className="text-slate-500">{c.nombre}</span>
                      </li>
                    ))}
                  </ul>
                  <span>{d.dias[n - 1].fecha.slice(8, 10)}/{d.dias[n - 1].fecha.slice(5, 7)}</span>
                </div>
              </div>
            );
          })()
        )}
      </Tarjeta>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Tarjeta titulo="En qué está ahora" icono={Bot} tono="violeta" padding="p-0" accion={<span className="text-[11px] text-slate-400">no depende del filtro</span>}>
          {d.abiertos.length === 0 ? (
            <div className="p-5"><Vacio titulo="No tiene nada abierto" detalle="Cuando tome un ticket aparece acá, con cuánto hace que lo tiene." icono={Bot} tono="violeta" /></div>
          ) : (
            <>
            <table className="w-full text-left text-[13px]">
              <tbody>
                {recortar("abiertos", d.abiertos).map((t) => (
                  <FilaTicket
                    key={t.numero}
                    t={t}
                    extra={
                      <td className="px-5 py-3 text-right">
                        <p className="text-[12px] font-medium text-slate-600">{desdeHace(t.desde)}</p>
                        <p className="mt-0.5 text-[11px] text-slate-400">{t.vueltas} {t.vueltas === 1 ? "vuelta" : "vueltas"} · {usd(t.usd)}</p>
                      </td>
                    }
                  />
                ))}
              </tbody>
            </table>
            <VerMas clave="abiertos" total={d.abiertos.length} />
            </>
          )}
        </Tarjeta>

        <Tarjeta titulo="Los que le volvieron" icono={RotateCcw} tono="rosa" padding="p-0">
          {d.volvieronLista.length === 0 ? (
            <div className="p-5"><Vacio titulo="Ninguno volvió" detalle="Los tickets que dio por resueltos y después se reabrieron aparecen acá." icono={RotateCcw} tono="rosa" /></div>
          ) : (
            <>
            <table className="w-full text-left text-[13px]">
              <tbody>
                {recortar("volvieron", d.volvieronLista).map((t) => (
                  <FilaTicket key={t.numero} t={t} extra={<td className="px-5 py-3 text-right tabular-nums text-[12px] text-slate-500">{t.vueltas} {t.vueltas === 1 ? "vuelta" : "vueltas"}</td>} />
                ))}
              </tbody>
            </table>
            <VerMas clave="volvieron" total={d.volvieronLista.length} />
            </>
          )}
        </Tarjeta>

        <Tarjeta titulo={d.rango.activo ? "Lo que trabajó en el período" : "Lo que trabajó hoy"} icono={Bot} tono="violeta" padding="p-0">
          {d.hoy.length === 0 ? (
            <div className="p-5"><Vacio titulo={d.rango.activo ? "No trabajó nada en ese período" : "Hoy todavía no trabajó"} icono={Bot} tono="violeta" /></div>
          ) : (
            <>
            <table className="w-full text-left text-[13px]">
              <tbody>
                {recortar("trabajados", d.hoy).map((t) => (
                  <FilaTicket
                    key={t.numero}
                    t={t}
                    extra={
                      <td className="px-5 py-3 text-right">
                        <p className="font-semibold tabular-nums text-slate-700">{usd(t.usd)}</p>
                        <p className="mt-0.5 text-[11px] text-slate-400">{t.vueltas} {t.vueltas === 1 ? "vuelta" : "vueltas"}</p>
                      </td>
                    }
                  />
                ))}
              </tbody>
            </table>
            <VerMas clave="trabajados" total={d.hoy.length} />
            </>
          )}
        </Tarjeta>

        <Tarjeta titulo="Los que más costaron" icono={Flame} tono="ambar" padding="p-0">
          {d.caros.length === 0 ? (
            <div className="p-5"><Vacio titulo="Todavía no hay gasto por ticket" icono={Flame} tono="ambar" /></div>
          ) : (
            <table className="w-full text-left text-[13px]">
              <tbody>
                {d.caros.map((t) => (
                  <FilaTicket
                    key={t.numero}
                    t={t}
                    extra={
                      <td className="px-5 py-3 text-right">
                        <p className="font-semibold tabular-nums text-slate-700">{usd(t.usd)}</p>
                        <p className="mt-0.5 text-[11px] text-slate-400">{t.vueltas} {t.vueltas === 1 ? "vuelta" : "vueltas"}</p>
                      </td>
                    }
                  />
                ))}
              </tbody>
            </table>
          )}
        </Tarjeta>

        <Tarjeta titulo="En qué sistemas gastó" icono={Server} tono="celeste" className="xl:col-span-2">
          {d.sistemas.length === 0 ? (
            <Vacio titulo="Sin gasto informado todavía" icono={Server} tono="celeste" />
          ) : (
            (() => {
              // Las cargas a mano se juntan en una sola porción; el resto entra completo.
              const juntos = new Map<string, { usd: number; tickets: number; vueltas: number }>();
              for (const x of d.sistemas) {
                const k = nombreCorto(x.nombre);
                const a = juntos.get(k) ?? { usd: 0, tickets: 0, vueltas: 0 };
                a.usd += x.usd;
                a.tickets += x.tickets;
                a.vueltas += x.vueltas;
                juntos.set(k, a);
              }
              const porciones = [...juntos.entries()].map(([nombre, v]) => ({ nombre, ...v })).sort((a, b) => b.usd - a.usd);
              const total = porciones.reduce((a, x) => a + x.usd, 0) || 1;
              let acum = 0;
              const conArco = porciones.map((x, i) => {
                const t0 = DONA.INICIO + acum / total;
                acum += x.usd;
                return {
                  ...x,
                  t0,
                  t1: DONA.INICIO + acum / total,
                  pct: (x.usd / total) * 100,
                  color: colorPorcion(i),
                  corte: colorCorte(i),
                  sombra: colorPared(i),
                };
              });
              const activa = porcionActiva;
              const act = conArco.find((x) => x.nombre === activa) ?? null;
              const iAct = act ? conArco.indexOf(act) : -1;
              const previa = act ? conArco[(iAct - 1 + conArco.length) % conArco.length] : null;
              const siguiente = act ? conArco[(iAct + 1) % conArco.length] : null;
              const mov = act ? hacia(act.t0, act.t1) : { x: 0, y: 0 };
              // Paredes de afuera de atrás hacia adelante. La de la pieza despegada va aparte.
              const afuera = conArco
                .filter((x) => x !== act)
                .flatMap((x) => paredAfuera(x.t0, x.t1).map((d0) => ({ x, d: d0, z: enAro((x.t0 + x.t1) / 2, DONA.R).y })))
                .sort((a, b) => a.z - b.z);
              const adentro = conArco.flatMap((x) => paredAdentro(x.t0, x.t1).map((d0) => ({ x, d: d0 })));
              const { r, K } = DONA;
              const agujero = `M ${r} 0 A ${r} ${r * K} 0 1 1 ${-r} 0 A ${r} ${r * K} 0 1 1 ${r} 0 Z`;
              return (
                <div className="flex flex-col items-center">
                  <svg viewBox="-130 -100 260 210" className="w-full max-w-[520px]" role="img" aria-label="Gasto por sistema">
                    <defs>
                      <clipPath id="neurita-hueco">
                        <path d={agujero} />
                      </clipPath>
                      <radialGradient id="neurita-sombra">
                        <stop offset="0" stopColor="#0f172a" stopOpacity="0.16" />
                        <stop offset="1" stopColor="#0f172a" stopOpacity="0" />
                      </radialGradient>
                    </defs>
                    {/* La sombra en el piso: es lo que la hace parecer apoyada y no pegada. */}
                    <ellipse cx="6" cy="94" rx="84" ry="12" fill="url(#neurita-sombra)" />
                    <g transform={`rotate(${DONA.GIRO})`}>
                      {/* Lo que se ve por el agujero: la pared interna de la mitad de atrás. */}
                      <g clipPath="url(#neurita-hueco)">
                        {adentro.map(({ x, d: d0 }, i) => (
                          <path key={`in-${x.nombre}-${i}`} d={d0} fill={x.corte} className="pointer-events-none" />
                        ))}
                      </g>
                      {afuera.map(({ x, d: d0 }, i) => (
                        <path key={`out-${x.nombre}-${i}`} d={d0} fill={x.sombra} className="pointer-events-none" />
                      ))}
                      {/* El hueco que deja la pieza: las vecinas muestran su cara del corte. */}
                      {act && previa && siguiente && (
                        <g className="pointer-events-none">
                          {seVeFinal(act.t0) && <path d={caraAro(act.t0)} fill={previa.sombra} />}
                          {seVeInicio(act.t1) && <path d={caraAro(act.t1)} fill={siguiente.sombra} />}
                        </g>
                      )}
                      {conArco
                        .filter((x) => x !== act)
                        .map((x) => (
                          <path key={x.nombre} d={tapaAro(x.t0, x.t1)} fill={x.color} className="pointer-events-none" />
                        ))}
                      {/* La pieza despegada, entera: caras del corte, paredes y tapa. */}
                      {act && (
                        <g
                          transform={`translate(${mov.x} ${mov.y})`}
                          className="pointer-events-none"
                          style={{ transition: "transform 200ms ease-out" }}
                        >
                          {/* Las caras laterales van en el tono de pared: con luz de arriba, solo la tapa es clara. */}
                          {seVeInicio(act.t0) && <path d={caraAro(act.t0)} fill={act.sombra} />}
                          {seVeFinal(act.t1) && <path d={caraAro(act.t1)} fill={act.sombra} />}
                          {paredAdentro(act.t0, act.t1).map((d0, i) => (
                            <path key={`ain-${i}`} d={d0} fill={act.corte} />
                          ))}
                          {paredAfuera(act.t0, act.t1).map((d0, i) => (
                            <path key={`aout-${i}`} d={d0} fill={act.sombra} />
                          ))}
                          <path d={tapaAro(act.t0, act.t1)} fill={act.color} />
                        </g>
                      )}
                      {/*
                        El cursor se escucha sobre aros que NO se mueven. Si escucharan
                        las piezas, al despegarse saldrían de abajo del mouse y titilaría.
                      */}
                      {conArco.map((x) => (
                        <path
                          key={`hit-${x.nombre}`}
                          d={tapaAro(x.t0, x.t1)}
                          fill="transparent"
                          onMouseEnter={() => setPorcionActiva(x.nombre)}
                          onMouseLeave={() => setPorcionActiva((p) => (p === x.nombre ? null : p))}
                          className="cursor-pointer"
                        >
                          <title>{`${x.nombre}: ${usd(x.usd)} (${x.pct.toFixed(1)}%)`}</title>
                        </path>
                      ))}
                    </g>
                    {/* Los porcentajes van sin girar, para que se lean derechos. */}
                    {conArco
                      .filter((x) => x.pct >= 6)
                      .map((x) => {
                        const v = x.nombre === activa ? hacia(x.t0, x.t1) : { x: 0, y: 0 };
                        const m = enAro((x.t0 + x.t1) / 2, (DONA.R + DONA.r) / 2);
                        const g = girado(m.x + v.x, m.y + v.y);
                        return (
                          <text
                            key={`pct-${x.nombre}`}
                            x={g.x}
                            y={g.y + 2.5}
                            textAnchor="middle"
                            className="pointer-events-none fill-white text-[7px] font-bold transition-all duration-200"
                          >
                            {Math.round(x.pct)}%
                          </text>
                        );
                      })}
                  </svg>
                  {/* Lo que dice la porción elevada, o el total si no hay ninguna. */}
                  <div className="-mt-1 h-9 text-center">
                    {activa ? (
                      (() => {
                        const x = conArco.find((y) => y.nombre === activa);
                        if (!x) return null;
                        return (
                          <>
                            <p className="text-[14px] font-semibold text-slate-800">
                              {x.nombre} · {usd(x.usd)}
                            </p>
                            <p className="text-[11px] text-slate-400">
                              {x.pct.toFixed(1)}% del gasto
                              {x.tickets ? ` · ${x.tickets} ${x.tickets === 1 ? "ticket" : "tickets"}` : ""} · {x.vueltas} vueltas
                            </p>
                          </>
                        );
                      })()
                    ) : (
                      <>
                        <p className="text-[14px] font-semibold text-slate-800">{usd(total)}</p>
                        <p className="text-[11px] text-slate-400">
                          en {porciones.length} {porciones.length === 1 ? "sistema" : "sistemas"} · pasá el cursor por una porción
                        </p>
                      </>
                    )}
                  </div>
                  {/* Leyenda secundaria: para las porciones finas que no tienen etiqueta. */}
                  <ul className="mt-4 flex w-full flex-wrap justify-center gap-x-4 gap-y-1.5 border-t border-slate-100 pt-3">
                    {conArco.map((x) => (
                      <li
                        key={x.nombre}
                        onMouseEnter={() => setPorcionActiva(x.nombre)}
                        onMouseLeave={() => setPorcionActiva((p) => (p === x.nombre ? null : p))}
                        className={`flex cursor-default items-center gap-1.5 rounded px-1 text-[11px] transition-colors ${
                          activa === x.nombre ? "bg-slate-100 text-slate-600" : "text-slate-400"
                        }`}
                      >
                        <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: x.color }} aria-hidden />
                        <span className="text-slate-500">{x.nombre}</span>
                        <span className="tabular-nums">{x.pct < 1 ? "<1" : Math.round(x.pct)}%</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })()
          )}
        </Tarjeta>

        <Tarjeta titulo={`Todo lo que resolvió (${d.resueltos.length})`} icono={CheckCircle2} tono="verde" padding="p-0" className="xl:col-span-2">
          {d.resueltos.length === 0 ? (
            <div className="p-5"><Vacio titulo="Todavía no resolvió ninguno" icono={CheckCircle2} tono="verde" /></div>
          ) : (
            <>
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-2.5">Ticket</th>
                  <th className="px-3 py-2.5">Lo resolvió</th>
                  <th className="px-5 py-2.5 text-right">Costo</th>
                </tr>
              </thead>
              <tbody>
                {recortar("resueltos", d.resueltos).map((t) => (
                  <FilaTicket
                    key={t.numero}
                    t={t}
                    extra={
                      <>
                        <td className="px-3 py-3 text-[12px] text-slate-500">
                          {new Date(t.resuelto_at).toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit" })}
                          {t.volvio ? <span className="ml-2 rounded bg-rose-50 px-1.5 py-0.5 text-[11px] font-semibold text-rose-600">volvió</span> : null}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {t.usd > 0 ? (
                            <>
                              <p className="font-semibold tabular-nums text-slate-700">{usd(t.usd)}</p>
                              <p className="mt-0.5 text-[11px] text-slate-400">{t.vueltas} {t.vueltas === 1 ? "vuelta" : "vueltas"}</p>
                            </>
                          ) : (
                            <span className="text-[12px] text-slate-300" title="Se resolvió antes de que el agente empezara a informar su gasto">sin dato</span>
                          )}
                        </td>
                      </>
                    }
                  />
                ))}
              </tbody>
            </table>
            <VerMas clave="resueltos" total={d.resueltos.length} />
            </>
          )}
        </Tarjeta>
      </div>

      <p className="mt-5 text-[12px] leading-relaxed text-slate-400">
        El gasto se cuenta desde que el agente empezó a informarlo (11/11/2026): lo de antes no está. Los tickets resueltos, los tiempos y las
        reaperturas salen del historial y cubren todo. &quot;Vueltas&quot; es cuántas veces trabajó el modelo sobre ese ticket.
      </p>
    </Pagina>
  );
}
