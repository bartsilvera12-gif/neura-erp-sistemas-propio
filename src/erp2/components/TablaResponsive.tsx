"use client";

/**
 * Tablas responsive del ERP. Dos patrones — CUÁNDO USAR CADA UNO:
 *
 * 1) `TablaTarjetas` — LISTAS de registros (clientes, productos, ventas, compras, usuarios,
 *    tickets…): en < 768 px cada fila es un RENGLÓN compacto, como una app de banco: (foto),
 *    título y valor arriba; abajo una línea gris con subtítulo y datos separados por " · " y el
 *    estado (primer chip) a la derecha; acciones ("⋯") en el mismo renglón. Tocarlo abre la
 *    ficha; sin `onFila`, el detalle se pliega en "Ver más". En tablet/escritorio es la tabla. Úsala cuando la persona busca UN registro y lo abre / actúa sobre él.
 *
 *      <TablaTarjetas
 *        filas={rows} claveFila={(r) => r.id} onFila={(r) => abrir(r.id)}
 *        columnas={[
 *          { key: "nombre", titulo: "Nombre", celda: (r) => r.nombre, movil: "titulo" },
 *          { key: "ruc", titulo: "RUC", celda: (r) => r.ruc, movil: "subtitulo" },
 *          { key: "deuda", titulo: "Deuda", celda: (r) => gs(r.deuda), movil: "valor", claseTd: "text-right" },
 *          { key: "estado", titulo: "Estado", celda: (r) => <Badge …/>, movil: "chip" },
 *          { key: "tel", titulo: "Teléfono", celda: (r) => r.tel, movil: "dato" },      // visible, con etiqueta
 *          { key: "email", titulo: "Email", celda: (r) => r.email },                    // (por defecto) "detalle": plegado
 *          { key: "acc", titulo: "", celda: (r) => <Acciones …/>, movil: "acciones" },
 *        ]}
 *      />
 *    Roles en el renglón (`movil`): imagen (a la izquierda) · titulo (una línea) · subtitulo y dato
 *    (la línea gris, máx. 4 datos, sin etiqueta) · valor (arriba a la derecha) · chip (el primero
 *    abajo a la derecha, el resto en la línea gris) · detalle (plegado, por defecto) · acciones
 *    (solo íconos como "⋯", a la derecha, no abren la fila) · pie (botones con texto, fila aparte
 *    debajo, a todo el ancho) · oculto. Lo vacío (null, "", "—") no se muestra.
 *
 * 2) `TablaScroll` — tablas NATURALMENTE ANCHAS y numéricas (reportes, estados de cuenta,
 *    kardex, comparativos por mes): se mantiene la tabla en todas las pantallas, con scroll
 *    horizontal INTERNO dentro de su tarjeta (la página nunca scrollea de costado), primera
 *    columna fija y sombras en los bordes que indican que hay más.
 *
 *      <TablaScroll primeraFija minAncho={720}>
 *        <table className="w-full text-sm">…</table>
 *      </TablaScroll>
 *
 *    Regla práctica: si en el celular hay que COMPARAR columnas entre filas → TablaScroll; si
 *    hay que ENCONTRAR una fila y abrirla → TablaTarjetas.
 */
import { Fragment, memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMediaQuery } from "@/erp2/lib/ui/responsive";

/** Debajo de este ancho las listas se ven como tarjetas (tablet vertical ya ve la tabla). */
export const MQ_TARJETAS = "(max-width: 767.98px)";
export const useVistaTarjetas = () => useMediaQuery(MQ_TARJETAS);

export type RolMovil = "imagen" | "titulo" | "subtitulo" | "valor" | "chip" | "dato" | "detalle" | "acciones" | "pie" | "oculto";

export type ColumnaTabla<T> = {
  key: string;
  /** encabezado de la tabla (y etiqueta en la tarjeta si es texto) */
  titulo: ReactNode;
  celda: (fila: T) => ReactNode;
  /** clases del <th> (alineación, ocultar en md: "hidden lg:table-cell"…) */
  claseTh?: string;
  /** clases del <td> */
  claseTd?: string;
  /** rol en la tarjeta móvil (por defecto "detalle": plegado en "Ver más") */
  movil?: RolMovil;
  /** etiqueta en la tarjeta si `titulo` no es texto */
  etiquetaMovil?: string;
  /** contenido distinto en la tarjeta (ej. más corto) */
  celdaMovil?: (fila: T) => ReactNode;
};

const TH_BASE = "whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500";
const TD_BASE = "px-3 py-2.5";

export function TablaTarjetas<T>({
  filas,
  columnas,
  claveFila,
  onFila,
  onIntencion,
  onSinIntencion,
  vacio,
  cargando = false,
  claseFila,
  claseTabla = "w-full text-sm",
  claseThead = "border-b border-slate-200 bg-slate-50/80",
  minAncho,
  forzar,
  thBase = TH_BASE,
  tdBase = TD_BASE,
}: {
  filas: T[];
  columnas: ColumnaTabla<T>[];
  claveFila: (fila: T) => string;
  /** tocar la fila / tarjeta (abrir ficha) */
  onFila?: (fila: T) => void;
  /** hover / pointerdown (prefetch) */
  onIntencion?: (fila: T, ya?: boolean) => void;
  /** el mouse salió de la fila (cancelar el prefetch) */
  onSinIntencion?: () => void;
  /** contenido cuando no hay filas (se muestra igual en tabla y tarjetas) */
  vacio?: ReactNode;
  /** atenúa las filas mientras llega la página nueva */
  cargando?: boolean;
  claseFila?: (fila: T) => string;
  claseTabla?: string;
  claseThead?: string;
  /** ancho mínimo de la tabla (≥ 768 px; si no entra, scroll interno) */
  minAncho?: number;
  /** forzar una vista (pruebas / pantallas que deciden solas) */
  forzar?: "tabla" | "tarjetas";
  /** clases base de cada <th> / <td> (las de la columna se suman) */
  thBase?: string;
  tdBase?: string;
}) {
  const esAngosta = useVistaTarjetas();
  const tarjetas = forzar ? forzar === "tarjetas" : esAngosta;

  if (!filas.length && vacio) return <>{vacio}</>;

  if (tarjetas) {
    return (
      <ul className={`divide-y divide-slate-100 ${cargando ? "opacity-60" : ""}`}>
        {filas.map((f) => (
          <TarjetaFila key={claveFila(f)} fila={f} columnas={columnas} onFila={onFila} onIntencion={onIntencion} clase={claseFila?.(f)} />
        ))}
      </ul>
    );
  }

  return (
    <TablaScroll minAncho={minAncho}>
      <table className={claseTabla}>
        <thead className={claseThead}>
          <tr>
            {columnas.map((c) => <th key={c.key} scope="col" className={`${thBase} ${c.claseTh ?? ""}`}>{c.titulo}</th>)}
          </tr>
        </thead>
        <tbody className={`divide-y divide-slate-100 ${cargando ? "opacity-60" : ""}`}>
          {filas.map((f) => (
            <FilaTabla key={claveFila(f)} fila={f} columnas={columnas} onFila={onFila} onIntencion={onIntencion} onSinIntencion={onSinIntencion} clase={claseFila?.(f)} tdBase={tdBase} />
          ))}
        </tbody>
      </table>
    </TablaScroll>
  );
}

// Filas memorizadas: tipear en un buscador o abrir un modal re-renderiza la página, pero una
// fila sólo se vuelve a dibujar si cambió su registro (o las columnas / callbacks).
const FilaTabla = memo(function FilaTabla<T>({ fila, columnas, onFila, onIntencion, onSinIntencion, clase, tdBase }: {
  fila: T; columnas: ColumnaTabla<T>[]; onFila?: (f: T) => void; onIntencion?: (f: T, ya?: boolean) => void; onSinIntencion?: () => void; clase?: string; tdBase: string;
}) {
  return (
    <tr
      onClick={onFila ? () => onFila(fila) : undefined}
      onMouseEnter={onIntencion ? () => onIntencion(fila) : undefined}
      onMouseLeave={onSinIntencion}
      onPointerDown={onIntencion ? () => onIntencion(fila, true) : undefined}
      className={`group transition-colors ${onFila ? "cursor-pointer hover:bg-[var(--brand-50)]" : ""} ${clase ?? ""}`}
    >
      {columnas.map((c) => <td key={c.key} className={`${tdBase} ${c.claseTd ?? ""}`}>{c.celda(fila)}</td>)}
    </tr>
  );
}) as <T>(p: { fila: T; columnas: ColumnaTabla<T>[]; onFila?: (f: T) => void; onIntencion?: (f: T, ya?: boolean) => void; onSinIntencion?: () => void; clase?: string; tdBase: string }) => ReactNode;

const etiqueta = <T,>(c: ColumnaTabla<T>) => c.etiquetaMovil ?? (typeof c.titulo === "string" ? c.titulo : "");
const conContenido = (n: ReactNode) => n != null && n !== false && n !== "" && n !== "—";

const TarjetaFila = memo(function TarjetaFila<T>({ fila, columnas, onFila, onIntencion, clase }: {
  fila: T; columnas: ColumnaTabla<T>[]; onFila?: (f: T) => void; onIntencion?: (f: T, ya?: boolean) => void; clase?: string;
}) {
  const [abierta, setAbierta] = useState(false);
  const rol = (c: ColumnaTabla<T>) => c.movil ?? "detalle";
  const ver = (c: ColumnaTabla<T>) => (c.celdaMovil ?? c.celda)(fila);
  const de = (r: RolMovil) => columnas.filter((c) => rol(c) === r);
  const imagen = de("imagen")[0];
  const titulo = de("titulo")[0];
  const subtitulo = de("subtitulo");
  const valor = de("valor")[0];
  const hay = (c: ColumnaTabla<T>) => conContenido(ver(c));
  const chips = de("chip").filter(hay);
  const datos = de("dato").slice(0, 4);
  const detalle = [...de("dato").slice(4), ...de("detalle")];
  const acciones = de("acciones").filter(hay);
  const pie = de("pie").filter(hay);

  // Renglón compacto (como una app de banco): título y valor arriba; abajo la línea gris con el
  // subtítulo y los datos clave separados por " · ", y el estado (primer chip) a la derecha.
  // Tocar abre la ficha: con `onFila` no hay "Ver más" (el detalle ya muestra todo).
  const meta = [...subtitulo, ...datos].filter(hay);
  const [chip, ...otrosChips] = chips;
  const conVerMas = detalle.length > 0 && !onFila;

  return (
    <li className={`relative ${clase ?? ""}`}>
      <div
        role={onFila ? "button" : undefined}
        tabIndex={onFila ? 0 : undefined}
        onClick={onFila ? () => onFila(fila) : undefined}
        onKeyDown={onFila ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onFila(fila); } } : undefined}
        onPointerDown={onIntencion ? () => onIntencion(fila, true) : undefined}
        className={`flex min-h-[68px] items-center gap-3 px-4 py-3 ${onFila ? "cursor-pointer active:bg-slate-50" : ""}`}
      >
        {imagen ? <div className="shrink-0">{ver(imagen)}</div> : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            {/* Título hasta 2 líneas: si la celda trae varias partes (nombre + detalle), queda la primera. */}
            {titulo ? <div className="line-clamp-2 min-w-0 text-[15px] font-semibold leading-snug text-slate-900 [overflow-wrap:anywhere] [&>*:not(:first-child)]:hidden [&_.block]:inline">{ver(titulo)}</div> : <span />}
            {valor ? <div className="shrink-0 text-right text-[15px] font-semibold leading-snug tabular-nums text-slate-900">{ver(valor)}</div> : null}
          </div>
          {meta.length || chip ? (
            <div className="mt-1 flex items-center justify-between gap-3">
              {/* Hasta 2 líneas; cada dato no se parte a la mitad. El punto separador queda recortado
                  afuera cuando el dato arranca una línea (por el margen negativo + overflow). */}
              <div className="max-h-[2.75em] min-w-0 overflow-hidden text-[13px] leading-snug text-slate-500 [overflow-wrap:anywhere] [&_.block]:inline [&_.block:not(:first-child)]:before:content-['_·_'] [&_.font-mono]:font-sans [&_span_div]:inline [&_span_p]:inline">
                <div className="-ml-[0.9em] flex flex-wrap">
                  {meta.map((c) => (
                    <span key={c.key} className="relative max-w-full pl-[0.9em] before:absolute before:left-[0.3em] before:text-slate-300 before:content-['·']">{ver(c)}</span>
                  ))}
                </div>
              </div>
              {chip ? <span className="inline-flex max-w-[45%] shrink-0 justify-end text-right [&_.flex-col]:items-end">{ver(chip)}</span> : null}
            </div>
          ) : null}
          {otrosChips.length ? <div className="mt-1.5 flex flex-wrap gap-1.5">{otrosChips.map((c) => <span key={c.key} className="inline-flex">{ver(c)}</span>)}</div> : null}
        </div>
        {/* Acciones (ej. "⋯") en el mismo renglón; no abren la fila. Sin acciones, la flecha. */}
        {acciones.length ? (
          <div className="-mr-2 flex shrink-0 items-center [&_button]:min-h-11 [&_button]:min-w-11" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            {acciones.map((c) => <span key={c.key} className="contents">{ver(c)}</span>)}
          </div>
        ) : onFila ? <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-slate-300" /> : null}
      </div>
      {/* Botones con texto en su propia fila: no le quitan lugar al nombre ni al monto. */}
      {pie.length ? (
        <div className="flex gap-2 px-4 pb-3 [&>div]:flex [&>div]:w-full [&>div]:gap-2 [&_a]:min-h-11 [&_a]:flex-1 [&_a]:justify-center [&_button]:min-h-11 [&_button]:flex-1 [&_button]:justify-center" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {pie.map((c) => <Fragment key={c.key}>{ver(c)}</Fragment>)}
        </div>
      ) : null}
      <div className="px-4">
        {abierta && conVerMas ? (
          <dl className="mt-2 space-y-1.5 rounded-lg bg-slate-50 px-3 py-2.5">
            {detalle.map((c) => (
              <div key={c.key} className="flex items-start justify-between gap-3">
                <dt className="shrink-0 text-[12px] text-slate-500">{etiqueta(c)}</dt>
                <dd className="min-w-0 text-right text-[13px] text-slate-800 [overflow-wrap:anywhere]">{ver(c)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      {conVerMas ? (
        <div className="flex items-center justify-between gap-2 px-2 pb-1.5">
          {conVerMas ? (
            <button type="button" onClick={() => setAbierta((v) => !v)} aria-expanded={abierta}
              className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-[var(--brand)]">
              {abierta ? "Ver menos" : `Ver más (${detalle.length})`}
              <ChevronDown className={`h-4 w-4 transition-transform ${abierta ? "rotate-180" : ""}`} />
            </button>
          ) : <span />}
        </div>
      ) : null}
    </li>
  );
}) as <T>(p: { fila: T; columnas: ColumnaTabla<T>[]; onFila?: (f: T) => void; onIntencion?: (f: T, ya?: boolean) => void; clase?: string }) => ReactNode;

/**
 * Contenedor de una tabla ancha: scroll horizontal INTERNO, sombras que indican que hay más a
 * la izquierda/derecha y (opcional) primera columna fija. Los colores de fondo de la columna
 * fija salen de `--tabla-fondo` (filas, por defecto blanco) y `--tabla-fondo-cabecera`.
 */
export function TablaScroll({
  children,
  primeraFija = false,
  minAncho,
  className = "",
}: {
  children: ReactNode;
  primeraFija?: boolean;
  /** ancho mínimo de la tabla en px (si la tabla no lo define) */
  minAncho?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [bordes, setBordes] = useState({ izq: false, der: false });
  const medir = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const izq = el.scrollLeft > 1;
    const der = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setBordes((b) => (b.izq === izq && b.der === der ? b : { izq, der }));
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    const t = el.querySelector("table");
    if (t) ro.observe(t);
    el.addEventListener("scroll", medir, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener("scroll", medir); };
  }, [medir]);

  // Desplazamiento al borde (solo mouse): con el puntero cerca del borde derecho o izquierdo la
  // tabla se va corriendo sola hacia ese lado; más cerca del borde, más rápido. En pantallas
  // táctiles no hace nada (ahí se desliza con el dedo) y con "reducir movimiento" tampoco.
  const velocidad = useRef(0);
  const animando = useRef<number | null>(null);
  const parar = useCallback(() => {
    velocidad.current = 0;
    if (animando.current != null) cancelAnimationFrame(animando.current);
    animando.current = null;
  }, []);
  const ultimo = useRef(0);
  const paso = useCallback((t: number) => {
    const el = ref.current;
    if (!el || !velocidad.current) { animando.current = null; return; }
    // Por tiempo (no por cuadro): la misma velocidad con 60 o con 144 Hz.
    const dt = ultimo.current ? Math.min(50, t - ultimo.current) : 16;
    ultimo.current = t;
    const antes = el.scrollLeft;
    el.scrollLeft += (velocidad.current * dt) / 16;
    if (el.scrollLeft === antes) { animando.current = null; return; } // llegó al tope
    animando.current = requestAnimationFrame(paso);
  }, []);
  const alMover = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || e.pointerType !== "mouse" || el.scrollWidth <= el.clientWidth + 1) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    const zona = Math.min(80, r.width / 6);
    const x = e.clientX - r.left;
    const MAX = 12; // px cada 16 ms en el borde mismo (~750 px/s)
    let v = 0;
    if (x > r.width - zona) v = Math.ceil(((x - (r.width - zona)) / zona) * MAX);
    else if (x < zona) v = -Math.ceil(((zona - x) / zona) * MAX);
    velocidad.current = v;
    if (v && animando.current == null) { ultimo.current = 0; animando.current = requestAnimationFrame(paso); }
    if (!v) parar();
  }, [paso, parar]);
  useEffect(() => parar, [parar]);

  return (
    <div className={`relative min-w-0 ${className}`} onPointerMove={alMover} onPointerLeave={parar}>
      <div
        ref={ref}
        className={`overflow-x-auto overscroll-x-contain ${primeraFija ? "tabla-primera-fija" : ""} ${bordes.izq ? "tabla-desplazada" : ""}`}
        style={minAncho ? ({ ["--tabla-min" as string]: `${minAncho}px` } as React.CSSProperties) : undefined}
      >
        <div className={minAncho ? "min-w-[var(--tabla-min)]" : ""}>{children}</div>
      </div>
      {/* Sombras de "hay más" (no capturan toques) */}
      <span aria-hidden className={`pointer-events-none absolute inset-y-0 left-0 w-4 bg-gradient-to-r from-slate-900/10 to-transparent transition-opacity ${bordes.izq && !primeraFija ? "opacity-100" : "opacity-0"}`} />
      <span aria-hidden className={`pointer-events-none absolute inset-y-0 right-0 w-5 bg-gradient-to-l from-slate-900/12 to-transparent transition-opacity ${bordes.der ? "opacity-100" : "opacity-0"}`} />
    </div>
  );
}
