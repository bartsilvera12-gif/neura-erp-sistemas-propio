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
  [351, 71, 62], // coral
  [205, 82, 64], // celeste
  [42, 85, 62],  // amarillo
  [168, 45, 50], // verde agua
  [247, 66, 71], // lavanda
  [22, 85, 65],  // naranja
  [150, 42, 55], // verde
  [330, 68, 71], // rosa
  [226, 60, 60], // azul
  [28, 48, 62],  // arena
  [288, 45, 66], // violeta
  [188, 52, 60], // turquesa
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
const CX = 100;
const CY = 70;
const RX = 92;
const RY = 50;
const ALTO3D = 26;
/** Cuánto se separa y cuánto sube una porción al pasarle el cursor. */
const SALTO = 5;
const ELEVACION = 10;

/**
 * La porción se despega hacia su lado y sube: la pared la acompaña, así que
 * queda flotando sobre la torta en vez de deslizarse sobre el plano.
 */
function salto(desde: number, hasta: number, activo: boolean) {
  if (!activo) return undefined;
  const a = 2 * Math.PI * ((desde + hasta) / 2) - Math.PI / 2;
  return `translate(${SALTO * Math.cos(a)} ${SALTO * Math.sin(a) * (RY / RX) - ELEVACION})`;
}

/** Punto del borde de la tapa, para una vuelta `t` (0 a 1). */
function borde(t: number, dy = 0) {
  const a = 2 * Math.PI * t - Math.PI / 2;
  return { x: CX + RX * Math.cos(a), y: CY + RY * Math.sin(a) + dy, a };
}

/** La tapa de una porción. */
function tapa(desde: number, hasta: number) {
  if (hasta - desde >= 0.999) {
    return `M ${CX} ${CY - RY} A ${RX} ${RY} 0 1 1 ${CX - 0.01} ${CY - RY} Z`;
  }
  const p1 = borde(desde);
  const p2 = borde(hasta);
  const grande = hasta - desde > 0.5 ? 1 : 0;
  return `M ${CX} ${CY} L ${p1.x} ${p1.y} A ${RX} ${RY} 0 ${grande} 1 ${p2.x} ${p2.y} Z`;
}

/**
 * La pared de una porción, si asoma por el frente. Solo se ve la mitad de
 * adelante de la torta: el tramo de la porción que cae ahí.
 */
function pared(desde: number, hasta: number): string | null {
  const ini = Math.max(desde, 0.25);
  const fin = Math.min(hasta, 0.75);
  if (fin <= ini) return null;
  const a = borde(ini);
  const b = borde(fin);
  return `M ${a.x} ${a.y} A ${RX} ${RY} 0 0 1 ${b.x} ${b.y} L ${b.x} ${b.y + ALTO3D} A ${RX} ${RY} 0 0 0 ${a.x} ${a.y + ALTO3D} Z`;
}

/**
 * Una de las dos caras rectas del corte, del centro al borde. Solo se ven
 * cuando la porción se separa del resto: mientras está en su lugar, las tapan
 * las vecinas.
 */
function caraCorte(t: number) {
  const b = borde(t);
  return `M ${CX} ${CY} L ${b.x} ${b.y} L ${b.x} ${b.y + ALTO3D} L ${CX} ${CY + ALTO3D} Z`;
}

/** Dónde cae la etiqueta de una porción: a mitad de su ángulo, sobre la tapa. */
function centro(desde: number, hasta: number, r = 0.62) {
  const a = 2 * Math.PI * ((desde + hasta) / 2) - Math.PI / 2;
  return { x: CX + RX * r * Math.cos(a), y: CY + RY * r * Math.sin(a) };
}

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

      <Tarjeta titulo={d.rango.activo ? `Gasto por día (${d.rango.diasGrafico} días)` : "Gasto de los últimos 14 días"} icono={Activity} tono="violeta" className="mb-5">
        <div className="flex h-40 gap-1.5">
          {d.dias.map((x) => (
            <div
              key={x.fecha}
              className="flex h-full min-w-0 flex-1 flex-col items-center gap-1"
              title={`${diaCorto(x.fecha)} · ${usd(x.usd)} · ${x.vueltas} ${x.vueltas === 1 ? "vuelta" : "vueltas"}`}
            >
              <span className="h-4 text-[10px] tabular-nums leading-4 text-slate-500">{x.usd > 0 ? x.usd.toFixed(2) : ""}</span>
              {/* La caja marca el alto; la barra se apoya en su piso. */}
              <div className="relative w-full flex-1">
                <div
                  className={`absolute bottom-0 w-full rounded-t ${x.usd > 0 ? "bg-violet-400" : "bg-slate-100"}`}
                  style={{ height: x.usd > 0 ? `${Math.max(6, (x.usd / picoDia) * 100)}%` : "2px" }}
                />
              </div>
              <span className="text-[10px] tabular-nums text-slate-400">{diaCorto(x.fecha)}</span>
            </div>
          ))}
        </div>
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
              // Las cargas a mano se juntan en una sola porción; de ahí en más
              // entran todos los sistemas, sin agrupar en "otros".
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
                const desde = acum / total;
                acum += x.usd;
                return {
                  ...x,
                  desde,
                  hasta: acum / total,
                  pct: (x.usd / total) * 100,
                  color: colorPorcion(i),
                  sombra: colorPared(i),
                  corte: colorCorte(i),
                };
              });
              // Las paredes se dibujan de atrás hacia adelante: si no, una
              // porción del fondo tapa a la de adelante.
              const paredes = conArco
                .map((x) => ({ ...x, d: pared(x.desde, x.hasta), prof: borde((x.desde + x.hasta) / 2).y }))
                .filter((x): x is typeof x & { d: string } => !!x.d)
                .sort((a, b) => a.prof - b.prof);
              return (
                <div className="flex flex-col items-center">
                  <svg
                    viewBox="0 0 200 156"
                    className="w-full max-w-[560px]"
                    role="img"
                    aria-label="Gasto por sistema"
                  >
                    {[...paredes]
                      .sort((a, b) => Number(a.nombre === porcionActiva) - Number(b.nombre === porcionActiva))
                      .map((x) => (
                      <path
                        key={`p-${x.nombre}`}
                        d={x.d}
                        fill={x.sombra}
                        transform={salto(x.desde, x.hasta, porcionActiva === x.nombre)}
                        className="pointer-events-none transition-transform duration-200 ease-out"
                      />
                    ))}
                    {/*
                      La porción elevada muestra sus dos caras del corte. Sin
                      esto, una porción de atrás —que no tiene pared, porque su
                      lado de afuera mira para el otro lado— se eleva como una
                      lámina sin espesor.
                    */}
                    {conArco
                      .filter((x) => x.nombre === porcionActiva)
                      .flatMap((x) => [
                        <path
                          key={`c1-${x.nombre}`}
                          d={caraCorte(x.desde)}
                          fill={x.sombra}
                          transform={salto(x.desde, x.hasta, true)}
                          className="pointer-events-none"
                        />,
                        <path
                          key={`c2-${x.nombre}`}
                          d={caraCorte(x.hasta)}
                          fill={x.corte}
                          transform={salto(x.desde, x.hasta, true)}
                          className="pointer-events-none"
                        />,
                      ])}
                    {/* La elevada va última: si no, la porción siguiente le pasa por encima. */}
                    {[...conArco]
                      .sort((a, b) => Number(a.nombre === porcionActiva) - Number(b.nombre === porcionActiva))
                      .map((x) => (
                        <path
                          key={x.nombre}
                          d={tapa(x.desde, x.hasta)}
                          fill={x.color}
                          transform={salto(x.desde, x.hasta, porcionActiva === x.nombre)}
                          className="pointer-events-none transition-transform duration-200 ease-out"
                        />
                      ))}
                    {/* El nombre entra sólo en las porciones anchas; de 4% a 10% va
                        solo el porcentaje, y lo más fino se lee en la leyenda. */}
                    {conArco
                      .filter((x) => x.pct >= 4 && x.pct < 10)
                      .map((x) => {
                        const c = centro(x.desde, x.hasta, 0.68);
                        return (
                          <text
                            key={`pc-${x.nombre}`}
                            x={c.x}
                            y={c.y + 2}
                            textAnchor="middle"
                            transform={salto(x.desde, x.hasta, porcionActiva === x.nombre)}
                            className="pointer-events-none fill-white text-[5px] font-semibold transition-transform duration-200 ease-out"
                          >
                            {Math.round(x.pct)}%
                          </text>
                        );
                      })}
                    {conArco
                      .filter((x) => x.pct >= 10)
                      .map((x) => {
                        const c = centro(x.desde, x.hasta);
                        return (
                          <g
                            key={`et-${x.nombre}`}
                            transform={salto(x.desde, x.hasta, porcionActiva === x.nombre)}
                            className="pointer-events-none transition-transform duration-200 ease-out"
                          >
                            <text x={c.x} y={c.y - 1} textAnchor="middle" className="fill-white text-[5.5px] font-semibold">
                              {x.nombre.length > 14 ? `${x.nombre.slice(0, 13)}…` : x.nombre}
                            </text>
                            <text x={c.x} y={c.y + 5.5} textAnchor="middle" className="fill-white/85 text-[5px]">
                              {Math.round(x.pct)}%
                            </text>
                          </g>
                        );
                      })}
                    {/*
                      El cursor se escucha acá, sobre porciones que NO se mueven.
                      Antes escuchaban las tapas: al elevarse salían de abajo del
                      cursor, se soltaba el hover, volvían a su lugar y arrancaba
                      de nuevo — titilaba sin parar en los bordes.
                    */}
                    {conArco.map((x) => (
                      <path
                        key={`hit-${x.nombre}`}
                        d={tapa(x.desde, x.hasta)}
                        fill="transparent"
                        onMouseEnter={() => setPorcionActiva(x.nombre)}
                        onMouseLeave={() => setPorcionActiva((p) => (p === x.nombre ? null : p))}
                        className="cursor-pointer"
                      >
                        <title>{`${x.nombre}: ${usd(x.usd)} (${x.pct.toFixed(1)}%)`}</title>
                      </path>
                    ))}
                  </svg>
                  <p className="mt-1 text-[12px] text-slate-500">
                    {usd(total)} en {porciones.length} {porciones.length === 1 ? "sistema" : "sistemas"}
                  </p>
                  {/* Leyenda secundaria: para las porciones finas que no entran en el gráfico. */}
                  <ul className="mt-4 flex w-full flex-wrap justify-center gap-x-4 gap-y-1.5 border-t border-slate-100 pt-3">
                    {conArco.map((x) => (
                      <li
                        key={x.nombre}
                        onMouseEnter={() => setPorcionActiva(x.nombre)}
                        onMouseLeave={() => setPorcionActiva((p) => (p === x.nombre ? null : p))}
                        className={`flex cursor-default items-center gap-1.5 rounded px-1 text-[11px] transition-colors ${
                          porcionActiva === x.nombre ? "bg-slate-100 text-slate-600" : "text-slate-400"
                        }`}
                        title={`${usd(x.usd)} · ${x.vueltas} vueltas`}
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
