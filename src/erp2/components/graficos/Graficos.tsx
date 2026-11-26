"use client";

/**
 * Kit de gráficos del ERP (SVG/HTML propio, sin librerías). Mismo estilo en todo el sistema:
 * marcas finas, esquinas de datos redondeadas pegadas al eje, grilla tenue, texto siempre en
 * tinta (nunca del color de la serie), tooltip al pasar el mouse y leyenda cuando hay ≥ 2 series.
 *
 *   · Columnas      columnas por período (apiladas si hay varias series) + marca del período
 *                   anterior para comparar; tooltip con el detalle y la variación.
 *   · Lineas        evolución de varias series (admite negativos: resultado), con cruz y tooltip.
 *   · BarrasH       ranking en barras horizontales rotuladas (opcional: presupuesto / segmentos).
 *   · Dona          composición con el total al centro.
 *   · BarraTramos   una barra 100 % por tramos (antigüedad de deudas) con su detalle.
 *   · ColumnasMes   evolución mensual de Gastos (mercadería + operativos + presupuesto).
 *
 * Responsive: el SVG se dibuja al ancho real (desde 240 px), las etiquetas del eje X se espacian
 * según su largo (nunca se pisan en 360 px), el tooltip queda siempre dentro del gráfico y en
 * pantallas táctiles se abre con un TAP (un 2.º tap sobre la misma columna ejecuta su onClick;
 * tocar afuera lo cierra).
 *
 * Paleta categórica fija (validada para daltonismo, orden fijo, nunca ciclada): SERIES.
 * El primer color (#16969b) es el turquesa de marca; el período anterior va en gris.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * Ancho real del gráfico en px: el SVG se dibuja a ese ancho (viewBox = ancho) para que los
 * textos y las marcas tengan siempre su tamaño de verdad, en una tarjeta angosta o en una ancha.
 */
function useAncho(porDefecto = 720) {
  const ref = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(porDefecto);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => setAncho(Math.max(240, Math.round(el.clientWidth)) || porDefecto);
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [porDefecto]);
  return [ref, ancho] as const;
}
import { corto, gs, mesCorto, nombreMes, pct, variacion } from "@/erp2/components/graficos/formato";

/**
 * Tooltip al TAP en pantallas táctiles: el 1.er toque sobre una marca la resalta y muestra el
 * tooltip; el 2.º toque sobre la MISMA marca ejecuta su acción (navegar / filtrar). Tocar fuera
 * del gráfico lo cierra. Con mouse, nada cambia (hover + click).
 */
function useTapTooltip<K>(ref: React.RefObject<HTMLElement | null>, hover: K | null, setHover: (k: K | null) => void) {
  const tactil = useRef(false);
  const antes = useRef<K | null>(null);
  useEffect(() => {
    if (hover == null) return;
    const fuera = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      if (!ref.current?.contains(e.target as Node)) setHover(null);
    };
    document.addEventListener("pointerdown", fuera);
    return () => document.removeEventListener("pointerdown", fuera);
  }, [hover, ref, setHover]);
  const alApretar = (e: React.PointerEvent) => {
    tactil.current = e.pointerType !== "mouse";
    antes.current = hover;
  };
  const alTocar = (k: K, accion?: () => void) => {
    if (tactil.current && antes.current !== k) { setHover(k); return; }
    accion?.();
  };
  return { alApretar, alTocar };
}

/** Cada cuántas etiquetas del eje X se dibuja una, para que no se pisen (≈ 6 px por carácter). */
function pasoEtiquetas(etiquetas: string[], anchoUtil: number) {
  const n = Math.max(etiquetas.length, 1);
  const largo = Math.max(3, ...etiquetas.map((e) => e.length));
  const necesita = largo * 6 + 10;
  return Math.max(1, Math.ceil(n / Math.max(1, anchoUtil / necesita)));
}

/** Orden categórico fijo: turquesa, naranja, violeta, amarillo, verde, rosa, azul, rojo. */
export const SERIES = ["#16969b", "#eb6834", "#4a3aa7", "#eda100", "#008300", "#e87ba4", "#2a78d6", "#e34948"];
export const C_MARCA = "#16969b";
export const C_ANTERIOR = "#94a3b8";
export const C_OTROS = "#cbd5e1";
/** Antigüedad de deudas: de "al día" a "+90 días" (de frío a rojo). */
export const C_TRAMOS = ["#16969b", "#eda100", "#eb6834", "#e34948", "#9f1239"];

/** Color FIJO por forma de pago (el mismo en todos los gráficos, aunque cambie el filtro). */
const C_METODO: Record<string, string> = {
  efectivo: SERIES[0], tarjeta_debito: SERIES[2], tarjeta_credito: SERIES[6], tarjeta: SERIES[1], transferencia: SERIES[3],
  qr: SERIES[5], cheque: SERIES[4], otro: "#94a3b8", credito: "#64748b",
};
export const colorMetodo = (m: string) => C_METODO[m] ?? "#94a3b8";

export const C_OPERATIVOS = "#16969b";
export const C_MERCADERIA = "#eb6834";
export const C_FIJO = "#4a3aa7";
export const C_VARIABLE = "#16969b";

export function Leyenda({ items }: { items: { color: string; label: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          {i.dashed ? (
            <span aria-hidden className="inline-block h-0 w-3.5 border-t-2 border-dashed" style={{ borderColor: i.color }} />
          ) : (
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: i.color }} />
          )}
          {i.label}
        </span>
      ))}
    </div>
  );
}

const Punto = ({ c }: { c: string }) => <span aria-hidden className="mr-1.5 inline-block h-2 w-2 rounded-[2px] align-middle" style={{ backgroundColor: c }} />;

/** Escala "redonda" para las líneas guía: paso 1/2/2,5/5 × 10ⁿ. */
function escala(min: number, max: number, lineas = 4) {
  const rango = Math.max(max - min, 1);
  const bruto = rango / lineas;
  const p10 = 10 ** Math.floor(Math.log10(bruto));
  const paso = [1, 2, 2.5, 5, 10].map((k) => k * p10).find((k) => k >= bruto) ?? bruto;
  const techo = paso * Math.ceil(max / paso);
  const piso = min < 0 ? -paso * Math.ceil(-min / paso) : 0;
  const ticks: number[] = [];
  for (let v = piso; v <= techo + paso / 2; v += paso) ticks.push(Math.round(v * 1e6) / 1e6);
  return { piso, techo: Math.max(techo, paso), ticks };
}

/** Rectángulo con las esquinas de ARRIBA redondeadas (la base queda pegada al eje). */
function barra(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

function Tooltip({ izquierdaPct, children }: { izquierdaPct: number; children: ReactNode }) {
  // Se mide y se corre para que NUNCA salga del gráfico (en 360 px el tooltip de 180 px
  // centrado en la primera columna se salía de la pantalla y generaba scroll horizontal).
  const ref = useRef<HTMLDivElement>(null);
  const [dx, setDx] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    const padre = el?.parentElement;
    if (!el || !padre) return;
    const w = el.offsetWidth;
    const W = padre.clientWidth;
    const centro = (izquierdaPct / 100) * W;
    const min = w / 2 + 2, max = W - w / 2 - 2;
    setDx(max < min ? W / 2 - centro : Math.min(Math.max(centro, min), max) - centro);
  }, [izquierdaPct, children]);
  return (
    <div ref={ref} className="pointer-events-none absolute top-1 z-10 min-w-[min(180px,100%)] max-w-[min(280px,100%)] rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur"
      style={{ left: `${izquierdaPct}%`, transform: `translateX(calc(-50% + ${dx}px))` }}>
      {children}
    </div>
  );
}

function FilaTip({ color, label, valor, fuerte }: { color?: string; label: string; valor: string; fuerte?: boolean }) {
  return (
    <p className={`flex justify-between gap-4 ${fuerte ? "text-slate-800" : "text-slate-600"}`}>
      <span>{color ? <Punto c={color} /> : null}{label}</span>
      <b className="tabular-nums">{valor}</b>
    </p>
  );
}

export function DeltaTexto({ actual, anterior, invertir = false }: { actual: number; anterior: number; invertir?: boolean }) {
  const v = variacion(actual, anterior);
  if (v == null) return <span className="text-slate-400">sin datos para comparar</span>;
  const sube = v >= 0;
  const bueno = invertir ? !sube : sube;
  return (
    <span className={bueno ? "text-emerald-600" : "text-rose-600"}>
      {sube ? "▲" : "▼"} {Math.abs(v).toLocaleString("es-PY", { maximumFractionDigits: 1 })} %
    </span>
  );
}

// ── Columnas ────────────────────────────────────────────────────────────────
export type DatoColumna = { x: string; valores: number[]; anterior?: number | null; nota?: string };

export function Columnas({
  datos, series, etiquetaX, tituloTooltip, anteriorLabel, alto = 230, fmt = gs, onClick, ariaLabel, vacio = "Sin datos en el período",
  resaltar,
}: {
  datos: DatoColumna[];
  series: { label: string; color: string }[];
  etiquetaX: (x: string, i: number) => string;
  tituloTooltip?: (x: string) => string;
  /** con valor: marca del período anterior en cada columna (y en el tooltip) */
  anteriorLabel?: string;
  alto?: number;
  fmt?: (n: number) => string;
  onClick?: (x: string) => void;
  ariaLabel: string;
  vacio?: string;
  /** x que se destaca (ej. hoy, que todavía no terminó) */
  resaltar?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, W] = useAncho();
  const H = alto, PADL = 48, PADB = 26, PADT = 10, PADR = 6;
  const n = Math.max(datos.length, 1);
  const totales = datos.map((d) => d.valores.reduce((a, v) => a + Math.max(v, 0), 0));
  const maxV = Math.max(1, ...totales, ...datos.map((d) => d.anterior ?? 0));
  const { techo, ticks } = escala(0, maxV);
  const y = (v: number) => PADT + (H - PADT - PADB) * (1 - v / techo);
  const banda = (W - PADL - PADR) / n;
  const ancho = Math.max(2, Math.min(42, banda * (n > 20 ? 0.66 : 0.58)));
  const gap = n > 40 ? 0 : 2;
  const cadaEtiqueta = pasoEtiquetas(datos.map((d, i) => etiquetaX(d.x, i)), W - PADL - PADR);
  const sinDatos = totales.every((t) => t === 0) && datos.every((d) => !d.anterior);
  const h = hover != null ? datos[hover] : null;
  const tap = useTapTooltip(ref, hover, setHover);

  return (
    <div ref={ref} className="relative select-none">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PADL} x2={W - PADR} y1={y(v)} y2={y(v)} stroke={v === 0 ? "#cbd5e1" : "#eef2f6"} strokeWidth={1} />
            <text x={PADL - 7} y={y(v) + 3.5} textAnchor="end" fontSize={10.5} fill="#94a3b8">{fmt === gs ? corto(v) : fmt(v)}</text>
          </g>
        ))}
        {datos.map((d, i) => {
          const cx = PADL + banda * i + banda / 2;
          const x = cx - ancho / 2;
          const on = hover === i;
          const dim = hover != null && !on ? 0.45 : 1;
          let acum = 0;
          const visibles = d.valores.map((v, s) => ({ v: Math.max(v, 0), s })).filter((p) => p.v > 0);
          const destacado = resaltar === d.x;
          return (
            <g key={d.x} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onPointerDown={tap.alApretar}
              onClick={() => tap.alTocar(i, onClick ? () => onClick(d.x) : undefined)}
              style={{ cursor: onClick ? "pointer" : "default" }}>
              <rect x={PADL + banda * i} y={PADT} width={banda} height={H - PADT - PADB} fill={on ? "#f1f5f9" : "transparent"} rx={4} />
              {visibles.map((p, k) => {
                const y1 = y(acum + p.v);
                const y0 = y(acum);
                acum += p.v;
                const ultimo = k === visibles.length - 1;
                const altoSeg = Math.max(y0 - y1 - (k > 0 ? gap : 0), 0.8);
                return (
                  <path key={p.s} d={barra(x, y1, ancho, altoSeg, ultimo ? Math.min(4, ancho / 2) : 0)} fill={series[p.s]?.color ?? C_MARCA}
                    opacity={dim * (destacado ? 0.75 : 1)} />
                );
              })}
              {anteriorLabel && d.anterior ? (
                <line x1={x - 3} x2={x + ancho + 3} y1={y(d.anterior)} y2={y(d.anterior)} stroke="#475569" strokeWidth={1.6}
                  strokeDasharray="3 2" opacity={dim * 0.8} />
              ) : null}
              {i % cadaEtiqueta === 0 || on ? (
                <text x={cx} y={H - 8} textAnchor="middle" fontSize={10.5} fill={on ? "#0f172a" : "#64748b"} fontWeight={on ? 600 : 400}>
                  {etiquetaX(d.x, i)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {sinDatos ? <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">{vacio}</p> : null}
      {h ? (
        <Tooltip izquierdaPct={((PADL + banda * (hover! + 0.5)) / W) * 100}>
          <p className="mb-1 font-semibold capitalize text-slate-800">{tituloTooltip ? tituloTooltip(h.x) : h.x}</p>
          {series.length > 1
            ? series.map((s, k) => <FilaTip key={s.label} color={s.color} label={s.label} valor={fmt(h.valores[k] ?? 0)} />)
            : null}
          <FilaTip label={series.length > 1 ? "Total" : series[0]?.label ?? "Total"} valor={fmt(totales[hover!])} fuerte />
          {anteriorLabel && h.anterior != null ? (
            <div className="mt-1 border-t border-slate-100 pt-1">
              <FilaTip label={anteriorLabel} valor={fmt(h.anterior)} />
              <p className="text-right"><DeltaTexto actual={totales[hover!]} anterior={h.anterior} /></p>
            </div>
          ) : null}
          {h.nota ? <p className="mt-1 text-[11px] text-slate-400">{h.nota}</p> : null}
        </Tooltip>
      ) : null}
    </div>
  );
}

// ── Líneas ──────────────────────────────────────────────────────────────────
export type SerieLinea = { label: string; color: string; valores: number[]; punteada?: boolean; area?: boolean };

export function Lineas({
  x, etiquetaX, tituloTooltip, series, alto = 240, fmt = gs, ariaLabel, onClick,
}: {
  x: string[];
  etiquetaX: (x: string, i: number) => string;
  tituloTooltip?: (x: string) => string;
  series: SerieLinea[];
  alto?: number;
  fmt?: (n: number) => string;
  ariaLabel: string;
  onClick?: (x: string) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, W] = useAncho();
  const H = alto, PADL = 52, PADB = 26, PADT = 12, PADR = 14;
  const n = Math.max(x.length, 1);
  const todos = series.flatMap((s) => s.valores);
  const { piso, techo, ticks } = escala(Math.min(0, ...todos), Math.max(1, ...todos));
  const y = (v: number) => PADT + (H - PADT - PADB) * (1 - (v - piso) / (techo - piso));
  const paso = n > 1 ? (W - PADL - PADR) / (n - 1) : 0;
  const px = (i: number) => (n > 1 ? PADL + paso * i : (W + PADL) / 2);
  const cadaEtiqueta = pasoEtiquetas(x.map((v, i) => etiquetaX(v, i)), W - PADL - PADR);
  const tap = useTapTooltip(ref, hover, setHover);
  const ruta = (vals: number[]) => vals.map((v, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  return (
    <div ref={ref} className="relative select-none">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}
        onMouseLeave={() => setHover(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PADL} x2={W - PADR} y1={y(v)} y2={y(v)} stroke={v === 0 ? "#94a3b8" : "#eef2f6"} strokeWidth={1} />
            <text x={PADL - 7} y={y(v) + 3.5} textAnchor="end" fontSize={10.5} fill="#94a3b8">{fmt === gs ? corto(v) : fmt(v)}</text>
          </g>
        ))}
        {series.filter((s) => s.area).map((s) => (
          <path key={`a-${s.label}`} d={`${ruta(s.valores)} L${px(n - 1)},${y(Math.max(piso, 0))} L${px(0)},${y(Math.max(piso, 0))} Z`} fill={s.color} opacity={0.08} />
        ))}
        {series.map((s) => (
          <path key={s.label} d={ruta(s.valores)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
            strokeDasharray={s.punteada ? "5 4" : undefined} />
        ))}
        {hover != null ? <line x1={px(hover)} x2={px(hover)} y1={PADT} y2={H - PADB} stroke="#cbd5e1" strokeWidth={1} /> : null}
        {hover != null ? series.map((s) => (
          <circle key={s.label} cx={px(hover)} cy={y(s.valores[hover] ?? 0)} r={4.5} fill={s.color} stroke="#fff" strokeWidth={2} />
        )) : null}
        {x.map((v, i) => (
          <g key={v}>
            <rect x={px(i) - (paso || W) / 2} y={PADT} width={paso || W} height={H - PADT - PADB} fill="transparent"
              onMouseEnter={() => setHover(i)} onPointerDown={tap.alApretar}
              onClick={() => tap.alTocar(i, onClick ? () => onClick(v) : undefined)} style={{ cursor: onClick ? "pointer" : "default" }} />
            {i % cadaEtiqueta === 0 || hover === i ? (
              <text x={px(i)} y={H - 8} textAnchor={n > 1 && i === n - 1 ? "end" : "middle"} fontSize={10.5} fill={hover === i ? "#0f172a" : "#64748b"} fontWeight={hover === i ? 600 : 400}>
                {etiquetaX(v, i)}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      {hover != null ? (
        <Tooltip izquierdaPct={(px(hover) / W) * 100}>
          <p className="mb-1 font-semibold capitalize text-slate-800">{tituloTooltip ? tituloTooltip(x[hover]) : x[hover]}</p>
          {series.map((s) => <FilaTip key={s.label} color={s.color} label={s.label} valor={fmt(s.valores[hover] ?? 0)} />)}
        </Tooltip>
      ) : null}
    </div>
  );
}

// ── Barras horizontales (ranking) ───────────────────────────────────────────
export type FilaBarra = {
  key: string;
  label: string;
  /** segmentos apilados (ej. mercadería + operativos); con uno solo es una barra simple */
  partes: { valor: number; color: string; label: string }[];
  presupuesto?: number | null;
  detalle?: string;
  /** texto chico a la derecha del valor (ej. "32 %") */
  extra?: string;
  onClick?: () => void;
  href?: string;
};

/** Barras horizontales rotuladas. Escala común = el mayor entre valores y presupuestos. */
export function BarrasH({ filas, vacio = "Sin datos en el período", max: maxFilas = 8, fmt = corto, fmtTip = gs }: {
  filas: FilaBarra[]; vacio?: string; max?: number; fmt?: (n: number) => string; fmtTip?: (n: number) => string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const visibles = useMemo(() => {
    if (filas.length <= maxFilas) return filas;
    const resto = filas.slice(maxFilas - 1);
    const suma = resto.reduce((a, f) => a + f.partes.reduce((b, p) => b + p.valor, 0), 0);
    return [...filas.slice(0, maxFilas - 1), { key: "__otros", label: `Otros (${resto.length})`, partes: [{ valor: suma, color: C_OTROS, label: "Otros" }] }];
  }, [filas, maxFilas]);
  const tope = Math.max(1, ...visibles.map((f) => Math.max(f.partes.reduce((a, p) => a + p.valor, 0), f.presupuesto ?? 0)));
  if (visibles.length === 0) return <p className="py-8 text-center text-sm text-slate-400">{vacio}</p>;
  return (
    <ul className="space-y-2.5">
      {visibles.map((f) => {
        const total = f.partes.reduce((a, p) => a + p.valor, 0);
        const pres = f.presupuesto ?? null;
        const excedido = pres != null && pres > 0 && total > pres;
        const on = hover === f.key;
        const cuerpo = (
          <>
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="min-w-0 truncate text-slate-700">{f.label}</span>
              <span className="shrink-0 tabular-nums font-semibold text-slate-800">
                {fmt(total)}
                {f.extra ? <span className="ml-1.5 text-[11px] font-medium text-slate-400">{f.extra}</span> : null}
                {pres != null && pres > 0 ? (
                  <span className={`ml-1.5 text-[11px] font-medium ${excedido ? "text-rose-600" : "text-slate-400"}`}>
                    {excedido ? "▲ " : ""}{Math.round((total / pres) * 100)} % de {corto(pres)}
                  </span>
                ) : null}
              </span>
            </div>
            <div className="relative mt-1 h-2.5 rounded-full bg-slate-100">
              <div className="absolute inset-y-0 left-0 flex overflow-hidden rounded-full" style={{ width: `${(total / tope) * 100}%`, gap: f.partes.length > 1 ? 2 : 0 }}>
                {f.partes.filter((p) => p.valor > 0).map((p) => (
                  <div key={p.label} className="h-full transition-opacity" style={{ width: `${(p.valor / Math.max(total, 1)) * 100}%`, backgroundColor: p.color, opacity: hover && !on ? 0.55 : 1 }} />
                ))}
              </div>
              {pres != null && pres > 0 ? (
                <div aria-hidden title={`Presupuesto ${gs(pres)}`} className="absolute -top-1 h-[18px] w-0.5 rounded-full bg-slate-700" style={{ left: `calc(${(pres / tope) * 100}% - 1px)` }} />
              ) : null}
            </div>
            {on && (f.detalle || f.partes.length > 1) ? (
              <p className="mt-1 text-[11px] text-slate-500">
                {f.partes.length > 1 ? f.partes.map((p) => `${p.label}: ${fmtTip(p.valor)}`).join(" · ") : null}
                {f.detalle ? <>{f.partes.length > 1 ? " · " : ""}{f.detalle}</> : null}
              </p>
            ) : null}
          </>
        );
        const clase = `group block w-full rounded-lg px-1 py-0.5 text-left ${f.onClick || f.href ? "cursor-pointer hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none" : ""}`;
        const eventos = { onMouseEnter: () => setHover(f.key), onMouseLeave: () => setHover(null), onFocus: () => setHover(f.key), onBlur: () => setHover(null) };
        return (
          <li key={f.key}>
            {f.href ? (
              <a href={f.href} {...eventos} className={clase}>{cuerpo}</a>
            ) : f.onClick ? (
              <button type="button" onClick={f.onClick} {...eventos} className={clase}>{cuerpo}</button>
            ) : (
              <div {...eventos} className={clase}>{cuerpo}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ── Columnas por mes de Gastos (mercadería + operativos + presupuesto) ─────
export function ColumnasMes({ meses, onMes }: {
  meses: { mes: string; compras: number; operativos: number; presupuesto: number | null }[];
  onMes?: (mes: string) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, W] = useAncho(640);
  const H = 220, PADL = 44, PADB = 26, PADT = 10;
  const n = Math.max(meses.length, 1);
  const tope = Math.max(1, ...meses.map((m) => Math.max(m.compras + m.operativos, m.presupuesto ?? 0)));
  const { techo, ticks } = escala(0, tope);
  const y = (v: number) => PADT + (H - PADT - PADB) * (1 - v / techo);
  const banda = (W - PADL) / n;
  const ancho = Math.min(46, banda * 0.56);
  const sinDatos = meses.every((m) => m.compras + m.operativos === 0);
  const h = hover != null ? meses[hover] : null;
  const cadaEtiqueta = pasoEtiquetas(meses.map((m) => mesCorto(m.mes)), W - PADL);
  const tap = useTapTooltip(ref, hover, setHover);

  return (
    <div ref={ref} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Gasto total por mes">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PADL} x2={W} y1={y(v)} y2={y(v)} stroke="#e2e8f0" strokeWidth={1} />
            <text x={PADL - 6} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill="#94a3b8">{corto(v)}</text>
          </g>
        ))}
        {meses.map((m, i) => {
          const cx = PADL + banda * i + banda / 2;
          const x = cx - ancho / 2;
          const yo = y(m.operativos);
          const yc = y(m.operativos + m.compras);
          const base = y(0);
          const on = hover === i;
          const dim = hover != null && !on ? 0.45 : 1;
          return (
            <g key={m.mes} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onPointerDown={tap.alApretar}
              onClick={() => tap.alTocar(i, onMes ? () => onMes(m.mes) : undefined)}
              style={{ cursor: onMes ? "pointer" : "default" }}>
              <rect x={PADL + banda * i} y={PADT} width={banda} height={H - PADT - PADB} fill={on ? "#f1f5f9" : "transparent"} rx={6} />
              {m.operativos > 0 ? (
                <path d={barra(x, yo, ancho, base - yo, m.compras > 0 ? 0 : 4)} fill={C_OPERATIVOS} opacity={dim} />
              ) : null}
              {m.compras > 0 ? (
                <path d={barra(x, yc, ancho, Math.max(yo - yc - (m.operativos > 0 ? 2 : 0), 0.5), 4)} fill={C_MERCADERIA} opacity={dim} />
              ) : null}
              {m.presupuesto ? (
                <line x1={x - 5} x2={x + ancho + 5} y1={y(m.presupuesto)} y2={y(m.presupuesto)} stroke="#334155" strokeWidth={2} strokeDasharray="4 3" opacity={dim} />
              ) : null}
              {i % cadaEtiqueta === 0 || on ? (
                <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} fill={on ? "#0f172a" : "#64748b"} fontWeight={on ? 600 : 400}>{mesCorto(m.mes)}</text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {sinDatos ? <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">Sin gastos en estos meses</p> : null}
      {h ? (
        <Tooltip izquierdaPct={((PADL + banda * (hover! + 0.5)) / W) * 100}>
          <p className="font-semibold capitalize text-slate-800">{nombreMes(h.mes)}</p>
          <FilaTip color={C_MERCADERIA} label="Mercadería" valor={gs(h.compras)} />
          <FilaTip color={C_OPERATIVOS} label="Operativos" valor={gs(h.operativos)} />
          <div className="mt-1 border-t border-slate-100 pt-1"><FilaTip label="Total" valor={gs(h.compras + h.operativos)} fuerte /></div>
          {h.presupuesto ? <FilaTip label="Presupuesto" valor={gs(h.presupuesto)} /> : null}
        </Tooltip>
      ) : null}
    </div>
  );
}

// ── Dona ────────────────────────────────────────────────────────────────────
/** Dona de composición con el total al centro. */
export function Dona({ partes, centro, sub, fmt = corto, onClick }: {
  partes: { label: string; valor: number; color: string; key?: string }[];
  centro: string;
  sub: string;
  fmt?: (n: number) => string;
  onClick?: (key: string) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = partes.reduce((a, p) => a + Math.max(p.valor, 0), 0);
  const R = 70, r = 50, C = 90;
  let ang = -Math.PI / 2;
  const arcos = partes.map((p) => {
    const a0 = ang;
    const frac = total > 0 ? Math.max(p.valor, 0) / total : 0;
    const a1 = ang + frac * Math.PI * 2;
    ang = a1;
    return { ...p, a0, a1, frac };
  });
  const sector = (a0: number, a1: number) => {
    const gap = arcos.filter((x) => x.frac > 0).length > 1 ? 0.025 : 0;
    const s = a0 + gap, e = Math.max(a1 - gap, s + 0.001);
    const large = e - s > Math.PI ? 1 : 0;
    const p = (rad: number, a: number) => `${C + rad * Math.cos(a)},${C + rad * Math.sin(a)}`;
    if (e - s >= Math.PI * 2 - 0.01) {
      return `M${C - R},${C} A${R},${R} 0 1 1 ${C + R},${C} A${R},${R} 0 1 1 ${C - R},${C} M${C - r},${C} A${r},${r} 0 1 0 ${C + r},${C} A${r},${r} 0 1 0 ${C - r},${C} Z`;
    }
    return `M${p(R, s)} A${R},${R} 0 ${large} 1 ${p(R, e)} L${p(r, e)} A${r},${r} 0 ${large} 0 ${p(r, s)} Z`;
  };
  const h = hover != null ? arcos[hover] : null;
  const caja = useRef<HTMLDivElement>(null);
  const tap = useTapTooltip(caja, hover, setHover);
  return (
    // Container query: al lado si la tarjeta es ancha (≥ 448 px), apilada si es angosta.
    <div className="@container" ref={caja}>
    <div className="flex flex-col items-center gap-4 @md:flex-row">
      <svg viewBox="0 0 180 180" className="h-40 w-40 shrink-0" role="img" aria-label={partes.map((p) => `${p.label} ${gs(p.valor)}`).join(", ")}>
        {total === 0 ? <circle cx={C} cy={C} r={(R + r) / 2} fill="none" stroke="#e2e8f0" strokeWidth={R - r} /> : null}
        {arcos.map((a, i) => a.frac > 0 ? (
          <path key={a.label} d={sector(a.a0, a.a1)} fill={a.color} fillRule="evenodd" opacity={hover != null && hover !== i ? 0.4 : 1}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onPointerDown={tap.alApretar}
            onClick={() => tap.alTocar(i, a.key && onClick ? () => onClick(a.key!) : undefined)}
            className="transition-opacity" style={{ cursor: onClick && a.key ? "pointer" : "default" }} />
        ) : null)}
        <text x={C} y={C - 2} textAnchor="middle" fontSize={15} fontWeight={700} fill="#0f172a">{h ? `${Math.round(h.frac * 100)} %` : centro}</text>
        <text x={C} y={C + 15} textAnchor="middle" fontSize={10} fill="#64748b">{h ? (h.label.length > 22 ? `${h.label.slice(0, 21)}…` : h.label) : sub}</text>
      </svg>
      <ul className="w-full space-y-1.5 text-sm">
        {arcos.map((a, i) => (
          <li key={a.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => a.key && onClick?.(a.key)}
            className={`flex items-center justify-between gap-3 rounded-lg px-2 py-1 ${hover === i ? "bg-slate-50" : ""} ${onClick && a.key ? "cursor-pointer" : ""}`}>
            <span className="flex min-w-0 items-center gap-2 text-slate-600"><Punto c={a.color} /><span className="truncate">{a.label}</span></span>
            <span className="whitespace-nowrap tabular-nums">
              <b className="text-slate-800">{fmt(a.valor)}</b>
              <span className="ml-1.5 text-xs text-slate-400">{Math.round(a.frac * 100)} %</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
    </div>
  );
}

// ── Barra por tramos (antigüedad) ───────────────────────────────────────────
export function BarraTramos({ tramos, fmt = gs, onClick, activo }: {
  tramos: { key: string; label: string; valor: number; color: string }[];
  fmt?: (n: number) => string;
  onClick?: (key: string) => void;
  activo?: string | null;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const total = tramos.reduce((a, t) => a + t.valor, 0);
  return (
    <div>
      <div className="flex h-4 w-full gap-[2px] overflow-hidden rounded-full bg-slate-100">
        {tramos.filter((t) => t.valor > 0).map((t) => (
          <div key={t.key} title={`${t.label}: ${fmt(t.valor)}`} onMouseEnter={() => setHover(t.key)} onMouseLeave={() => setHover(null)}
            onClick={() => onClick?.(t.key)}
            className="h-full transition-opacity first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(t.valor / Math.max(total, 1)) * 100}%`, backgroundColor: t.color, opacity: (hover && hover !== t.key) || (activo && activo !== t.key) ? 0.4 : 1, cursor: onClick ? "pointer" : "default" }} />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {tramos.map((t) => (
          <li key={t.key}>
            <button type="button" onClick={() => onClick?.(t.key)} onMouseEnter={() => setHover(t.key)} onMouseLeave={() => setHover(null)}
              disabled={!onClick}
              className={`w-full rounded-xl border px-3 py-2 text-left transition ${activo === t.key ? "border-slate-400 bg-slate-50" : "border-slate-100 hover:border-slate-200 hover:bg-slate-50"} disabled:cursor-default`}>
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500"><Punto c={t.color} />{t.label}</span>
              <span className="mt-0.5 block text-sm font-semibold tabular-nums text-slate-800">{fmt(t.valor)}</span>
              <span className="block text-[11px] tabular-nums text-slate-400">{pct(t.valor, total, 0)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
