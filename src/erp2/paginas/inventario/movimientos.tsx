"use client";

/**
 * /inventario/movimientos — Kardex. Cada movimiento nace de un DOCUMENTO con número
 * (compra = recarga de stock, venta, traslado salida/entrada, ajuste, pérdida, anulación):
 * acá no se carga nada a mano. Pestañas por tipo de documento, filtros por depósito /
 * sucursal, producto, tipo, fechas y búsqueda; Exportar Excel. Con ?producto=<id> es el
 * historial de UN producto con el saldo después de cada movimiento (en el depósito elegido
 * o el total).
 */
import Link from "next/link";
import { unidadCorta } from "@/erp2/modules/inventario/recetas";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Calendar, ClipboardCheck, Download, History, Loader2, Package, Search, X,
} from "lucide-react";
import { useUsuario } from "@/erp2/lib/sesion/ContextoUsuario";
import { descargarArchivo } from "@/erp2/lib/api/client-blob";
import { clienteConfig } from "@/erp2/cliente.config";
import { Select } from "@/erp2/components/Select";
import { AccionesPagina, BarraFiltros, EncabezadoPagina } from "@/erp2/components/EncabezadoPagina";
import { TablaScroll, TablaTarjetas, type ColumnaTabla } from "@/erp2/components/TablaResponsive";
import { Paginador, Pestanas } from "@/erp2/modules/inventario/ui";
import { precargarLista, useListaCacheada } from "@/erp2/modules/inventario/lista-cache";
import { GRUPOS_ORIGEN, ORIGEN_LABEL, hrefDocumento, type Movimiento, type TipoMovimiento } from "@/erp2/modules/inventario/kardex";
import { hayVariosDepositos, opcionesAlcance, partesAlcance, useDepositos } from "@/erp2/modules/inventario/depositos";
import { SelectorFecha } from "@/erp2/components/SelectorFecha";

const TEAL = clienteConfig.color;
const TZ = "America/Asuncion";
const POR_PAGINA = 25;

const TIPO_ICONO = { ENTRADA: ArrowDownToLine, SALIDA: ArrowUpFromLine } as const;
const ORIGEN_BADGE: Record<string, string> = {
  compra: "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
  venta: "bg-violet-50 text-violet-700 ring-1 ring-violet-200",
  traslado_salida: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200",
  traslado_entrada: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200",
  ajuste: "bg-slate-100 text-slate-700 ring-1 ring-slate-200",
  inventario_inicial: "bg-orange-50 text-orange-700 ring-1 ring-orange-200",
  perdida: "bg-red-50 text-red-700 ring-1 ring-red-200",
  apertura: "bg-slate-50 text-slate-500 ring-1 ring-slate-200",
  produccion: "bg-fuchsia-50 text-fuchsia-700 ring-1 ring-fuchsia-200",
};
const BADGE_ANULACION = "bg-rose-50 text-rose-700 ring-1 ring-rose-200";

const gs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
const cantidad = (n: number) => Number(n).toLocaleString("es-PY", { maximumFractionDigits: 3 });
const fecha = (iso: string) =>
  new Date(iso).toLocaleString("es-PY", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).replace(",", " ·");

type ProductoFiltro = { id: string; nombre: string; sku: string; stock_actual: number; unidad_medida: string; stock_deposito?: number };
type PaginaMov = { rows: Movimiento[]; total: number; producto: ProductoFiltro | null };

export default function MovimientosPage() {
  return (
    <Suspense fallback={null}>
      <Movimientos />
    </Suspense>
  );
}

function Movimientos() {
  const router = useRouter();
  const sp = useSearchParams();
  const productoId = sp.get("producto") ?? "";
  const esAdmin = useUsuario()?.rol === "ADMIN";
  const deps = useDepositos();

  const [exportando, setExportando] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [q, setQ] = useState("");
  const [grupo, setGrupo] = useState(sp.get("grupo") ?? "");
  const [tipo, setTipo] = useState("");
  const [alcance, setAlcance] = useState(sp.get("deposito") ? `d:${sp.get("deposito")}` : "");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  useEffect(() => {
    const texto = busqueda.trim();
    if (texto === q) return;
    const t = setTimeout(() => setQ(texto), 350);
    return () => clearTimeout(t);
  }, [busqueda, q]);

  const filtros = useMemo(() => {
    const p = new URLSearchParams();
    const { deposito, sucursal } = partesAlcance(alcance);
    const origenes = GRUPOS_ORIGEN.find((g) => g.id === grupo)?.origenes ?? [];
    if (q) p.set("q", q);
    if (tipo) p.set("tipo", tipo);
    if (origenes.length) p.set("origen", origenes.join(","));
    if (deposito) p.set("deposito", deposito);
    if (sucursal) p.set("sucursal", sucursal);
    if (desde) p.set("desde", desde);
    if (hasta) p.set("hasta", hasta);
    if (productoId) p.set("producto", productoId);
    return p;
  }, [q, tipo, grupo, alcance, desde, hasta, productoId]);

  // La página vuelve a 1 al cambiar un filtro sin un request intermedio con la página vieja.
  const claveFiltros = filtros.toString();
  const [pag, setPag] = useState({ de: claveFiltros, n: 1 });
  const pagina = pag.de === claveFiltros ? pag.n : 1;
  const setPagina = (f: (p: number) => number) =>
    setPag((x) => ({ de: claveFiltros, n: f(x.de === claveFiltros ? x.n : 1) }));

  const urlDe = (n: number) => {
    const p = new URLSearchParams(filtros);
    p.set("pagina", String(n));
    p.set("por_pagina", String(POR_PAGINA));
    return `/api/inventario/movimientos?${p}`;
  };
  const lista = useListaCacheada<PaginaMov>(urlDe(pagina));
  const { cargando } = lista;
  const items = useMemo(() => (lista.error ? [] : lista.datos?.rows ?? []), [lista.datos, lista.error]);
  const total = lista.error ? 0 : lista.datos?.total ?? 0;
  const producto = lista.datos?.producto ?? null;
  const conSaldo = !!productoId;

  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const urlSiguiente = !cargando && !lista.error && pagina < totalPaginas ? urlDe(pagina + 1) : null;
  useEffect(() => {
    if (!urlSiguiente) return;
    const t = setTimeout(() => precargarLista(urlSiguiente), 300);
    return () => clearTimeout(t);
  }, [urlSiguiente]);
  const varios = hayVariosDepositos(deps.datos);
  const opcAlcance = opcionesAlcance(deps.datos);
  const nombreAlcance = opcAlcance.find(([v]) => v === alcance)?.[1];

  // Columnas: en celular cada movimiento es una tarjeta (producto, fecha, cantidad, documento);
  // en tablet/escritorio, la tabla. El kardex de UN producto (con saldo) es siempre tabla, con
  // scroll interno y la fecha fija a la izquierda (ahí se comparan saldos entre filas).
  const columnas = useMemo<ColumnaTabla<Movimiento>[]>(() => {
    const cols: ColumnaTabla<Movimiento>[] = [
      {
        key: "fecha", titulo: "Fecha", movil: "subtitulo",
        claseTh: "!pl-4 sm:!pl-5", claseTd: "whitespace-nowrap !pl-4 text-xs tabular-nums text-slate-500 sm:!pl-5",
        // En celular (tabla del kardex con la fecha fija) la hora baja a otra línea: la columna fija queda angosta.
        celda: (m) => {
          const [d, h] = fecha(m.fecha).split(" · ");
          return <>{d}<span className="max-md:hidden"> · </span><span className="max-md:block">{h}</span></>;
        },
        celdaMovil: (m) => fecha(m.fecha),
      },
      {
        key: "producto", titulo: "Producto", movil: "titulo", claseTd: "max-w-[240px]",
        celda: (m) => (
          <>
            <Link href={`/inventario/movimientos?producto=${m.producto_id}`} className="block truncate font-semibold text-slate-800 hover:text-[var(--brand)] hover:underline" title="Ver el historial de este producto">
              {m.producto_nombre ?? "—"}
            </Link>
            <span className="font-mono text-[11px] font-normal text-slate-400">{m.producto_sku}</span>
          </>
        ),
        celdaMovil: (m) => (
          <>
            <Link href={`/inventario/movimientos?producto=${m.producto_id}`} className="-my-2.5 block py-2.5 text-slate-900 active:text-[var(--brand)]" title="Ver el historial de este producto">
              {m.producto_nombre ?? "—"}
            </Link>
            {m.producto_sku ? <span className="block font-mono text-[12px] font-normal text-slate-400">{m.producto_sku}</span> : null}
          </>
        ),
      },
      {
        key: "documento", titulo: "Documento", movil: "chip",
        celda: (m) => {
          const href = hrefDocumento(m);
          const badge = m.origen.startsWith("anulacion") ? BADGE_ANULACION : ORIGEN_BADGE[m.origen] ?? ORIGEN_BADGE.ajuste;
          const numero = m.documento_numero ? (
            href ? <Link href={href} className="font-mono font-semibold text-[var(--brand)] hover:underline [li_&]:inline-flex [li_&]:min-h-8 [li_&]:items-center [@media(pointer:coarse)]:[li_&]:-my-1.5 [@media(pointer:coarse)]:[li_&]:min-h-11">{m.documento_numero}</Link>
            : <span className="font-mono font-semibold text-slate-600">{m.documento_numero}</span>
          ) : <span className="text-slate-300">sin documento</span>;
          // Tabla: etiqueta y número uno debajo del otro. Tarjeta (celular): en una línea.
          return (
            <span className="block [li_&]:flex [li_&]:flex-wrap [li_&]:items-center [li_&]:gap-x-2 [li_&]:gap-y-1">
              <span className={`inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold ${badge}`}>{ORIGEN_LABEL[m.origen] ?? m.origen}</span>
              <span className="mt-1 block text-[11px] [li_&]:mt-0">{numero}</span>
            </span>
          );
        },
      },
      {
        key: "deposito", titulo: "Depósito", movil: "dato", claseTd: "max-w-[200px] text-xs",
        celda: (m) => {
          const entrada = m.tipo === "ENTRADA";
          const traslado = m.origen.startsWith("traslado") || m.origen === "anulacion_traslado";
          return (
            <>
              <span className="block truncate font-medium text-slate-700 [li_&]:whitespace-normal">{m.deposito_nombre ?? "—"}</span>
              {traslado && m.contraparte_nombre ? (
                <span className="flex items-center gap-1 truncate text-[11px] text-indigo-600 [li_&]:whitespace-normal">
                  <ArrowLeftRight className="h-3 w-3 shrink-0" /> {entrada ? "desde" : "hacia"} {m.contraparte_nombre}
                </span>
              ) : varios && m.sucursal_nombre ? <span className="block truncate text-[11px] text-slate-400 [li_&]:whitespace-normal">{m.sucursal_nombre}</span> : null}
            </>
          );
        },
      },
      {
        key: "cantidad", titulo: "Cantidad", movil: "valor", claseTh: "text-right", claseTd: "whitespace-nowrap text-right",
        celda: (m) => {
          const Icono = TIPO_ICONO[m.tipo as TipoMovimiento] ?? ArrowDownToLine;
          const entrada = m.tipo === "ENTRADA";
          return (
            <span className={`inline-flex items-center gap-1 font-bold tabular-nums ${entrada ? "text-emerald-700" : "text-red-600"}`}>
              <Icono className="h-3 w-3" strokeWidth={2.5} />{entrada ? "+" : "−"}{cantidad(Math.abs(m.cantidad))}
            </span>
          );
        },
      },
    ];
    if (conSaldo) {
      cols.push({
        key: "saldo", titulo: <span title="Stock después del movimiento">Saldo</span>, etiquetaMovil: "Saldo", movil: "dato",
        claseTh: "text-right", claseTd: "whitespace-nowrap text-right text-sm font-semibold tabular-nums text-slate-900",
        celda: (m) => (m.saldo == null ? <span className="text-slate-300">—</span> : cantidad(m.saldo)),
      });
    }
    cols.push(
      {
        key: "costo", titulo: "Costo unit.", movil: "detalle", claseTh: "text-right", claseTd: "whitespace-nowrap text-right text-xs tabular-nums text-slate-600",
        celda: (m) => gs(m.costo_unitario),
        celdaMovil: (m) => <span className="tabular-nums">{gs(m.costo_unitario)}</span>,
      },
      {
        key: "detalle", titulo: "Detalle · usuario", movil: "detalle", claseTd: "max-w-[220px] text-xs text-slate-500",
        celda: (m) => {
          const extra = [m.proveedor, m.numero_factura && `Fact. ${m.numero_factura}`].filter(Boolean).join(" · ");
          return (
            <span className="block min-w-0" title={[m.referencia, extra].filter(Boolean).join(" · ")}>
              <span className="block truncate">{m.referencia ?? "—"}</span>
              {extra ? <span className="block truncate text-[11px] text-slate-400">{extra}</span> : null}
              <span className="block truncate text-[11px] text-slate-400">{m.usuario_nombre ?? ""}</span>
            </span>
          );
        },
        celdaMovil: (m) => {
          const extra = [m.proveedor, m.numero_factura && `Fact. ${m.numero_factura}`].filter(Boolean).join(" · ");
          return (
            <span className="block">
              <span className="block">{m.referencia ?? "—"}</span>
              {extra ? <span className="block text-[12px] text-slate-500">{extra}</span> : null}
              {m.usuario_nombre ? <span className="block text-[12px] text-slate-500">{m.usuario_nombre}</span> : null}
            </span>
          );
        },
      },
    );
    return cols;
  }, [conSaldo, varios]);
  const hayFiltros = !!(busqueda || tipo || grupo || alcance || desde || hasta || productoId);

  function limpiar() {
    setBusqueda("");
    setTipo("");
    setGrupo("");
    setAlcance("");
    setDesde("");
    setHasta("");
    if (productoId) router.replace("/inventario/movimientos");
  }

  async function exportar() {
    setExportando(true);
    try {
      await descargarArchivo(`/api/inventario/movimientos/export?${filtros}`, "movimientos.xlsx");
    } catch {
      /* best-effort */
    } finally {
      setExportando(false);
    }
  }

  const input = "h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)] md:h-10";
  const nActivos = (tipo ? 1 : 0) + (alcance ? 1 : 0) + (desde ? 1 : 0) + (hasta ? 1 : 0);

  const vacio = (
    <div className="px-5 py-14 text-center sm:py-16">
      {cargando ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /> : (
        <>
          <div className="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-2xl border" style={{ backgroundColor: `${TEAL}14`, borderColor: `${TEAL}33` }}>
            <Package className="h-6 w-6" style={{ color: TEAL }} />
          </div>
          <p className="text-sm font-semibold text-slate-700">{hayFiltros ? "Ningún movimiento coincide con los filtros" : "Todavía no hay movimientos"}</p>
          <p className="mt-1 text-xs text-slate-500">Se generan solos con compras, ventas, traslados, ajustes y pérdidas.</p>
          {hayFiltros ? <button onClick={limpiar} className="mt-2 inline-flex min-h-11 items-center px-2 text-xs font-semibold hover:underline sm:min-h-0" style={{ color: TEAL }}>Limpiar filtros</button> : null}
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-5 pb-10 sm:space-y-6">
      <EncabezadoPagina
        volver={{ href: "/inventario/panel", label: "Inventario" }}
        kicker="Inventario · Kardex"
        titulo="Movimientos de inventario"
        subtitulo="Cada entrada y salida, con su documento, depósito y usuario"
        acciones={
          <AccionesPagina acciones={[
            ...(esAdmin ? [
              { etiqueta: "Nuevo ajuste", icono: <ClipboardCheck />, href: "/inventario/ajustes/nuevo?tipo=ajuste", primaria: true },
              { etiqueta: "Nuevo traslado", icono: <ArrowLeftRight />, href: "/inventario/traslados/nuevo" },
            ] : []),
            { etiqueta: exportando ? "Generando..." : "Exportar Excel", icono: <Download />, onClick: exportar, cargando: exportando, deshabilitada: total === 0 },
          ]} />
        }
      />

      {producto ? (
        <div className="flex flex-col gap-3 rounded-2xl border bg-white px-4 py-3.5 shadow-sm sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-5 sm:py-4" style={{ borderColor: `${TEAL}33` }}>
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${TEAL}1a`, color: TEAL }}>
              <History className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Kardex del producto{alcance ? ` · ${nombreAlcance}` : ""}</p>
              <p className="font-semibold text-slate-900 [overflow-wrap:anywhere]">{producto.nombre} <span className="font-mono text-xs font-normal text-slate-400">{producto.sku}</span></p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-slate-100 pt-3 sm:border-0 sm:pt-0">
            <div className="sm:text-right">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{alcance.startsWith("d:") ? "Stock en el depósito" : "Stock total"}</p>
              <p className="text-lg font-semibold tabular-nums text-slate-900">
                {cantidad(producto.stock_deposito ?? producto.stock_actual)}{" "}
                <span className="text-xs font-normal text-slate-400">{unidadCorta(producto.unidad_medida ?? "Unidad")}</span>
              </p>
            </div>
            <button onClick={() => router.replace("/inventario/movimientos")} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 sm:min-h-0 sm:px-2.5 sm:py-1.5">
              <X className="h-3.5 w-3.5" /> Ver todos
            </button>
          </div>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: `${TEAL}33` }}>
        {/* Pestañas por tipo de documento: si no entran, scrollean adentro (nunca saltan de línea). */}
        <div className="flex flex-col gap-2 border-b px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-5" style={{ borderColor: `${TEAL}22`, background: `linear-gradient(to right, ${TEAL}0d, transparent)` }}>
          <div className="min-w-0 max-w-full">
            <Pestanas opciones={GRUPOS_ORIGEN.map((g) => ({ id: g.id, label: g.label }))} valor={grupo} onChange={setGrupo} />
          </div>
          <span className="inline-flex h-[22px] shrink-0 items-center justify-center self-start rounded-full px-2 text-[11px] font-bold tabular-nums text-white sm:self-auto" style={{ backgroundColor: TEAL }}>
            {total.toLocaleString("es-PY")} {total === 1 ? "movimiento" : "movimientos"}
          </span>
        </div>

        {/* Filtros: búsqueda siempre a la vista; depósito, tipo y fechas en "Filtros" en celular. */}
        <div className="border-b border-slate-100 bg-slate-50/40 px-3 py-3 sm:px-5 sm:py-4">
          <BarraFiltros
            plano
            activos={nActivos}
            onLimpiar={hayFiltros ? limpiar : undefined}
            busqueda={
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input type="search" enterKeyHint="search" aria-label="Buscar movimientos" placeholder="Buscar por producto, SKU, documento, referencia o proveedor..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} className={`${input} w-full pl-9 pr-10`} />
                {busqueda ? (
                  <button onClick={() => setBusqueda("")} aria-label="Limpiar búsqueda" className="absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            }
          >
            {varios ? <Select value={alcance} onChange={setAlcance} options={opcAlcance} minWidth={220} etiqueta="Depósito o sucursal" /> : null}
            <Select value={tipo} onChange={setTipo} options={[["", "Entradas y salidas"], ["ENTRADA", "Solo entradas"], ["SALIDA", "Solo salidas"]]} minWidth={170} etiqueta="Tipo de movimiento" />
            <div className="flex min-w-0 items-center gap-2 max-md:flex-col max-md:items-stretch max-md:gap-1">
              <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500"><Calendar className="h-4 w-4 text-slate-400" /> Desde</span>
              <SelectorFecha compacto etiqueta="Desde" value={desde} onChange={setDesde} max={hasta || undefined} claseBoton="h-11 rounded-xl px-3 text-slate-800 md:h-10" className="min-w-0 md:w-[150px]" />
            </div>
            <div className="flex min-w-0 items-center gap-2 max-md:flex-col max-md:items-stretch max-md:gap-1">
              <span className="text-xs font-medium text-slate-500">Hasta</span>
              <SelectorFecha compacto etiqueta="Hasta" value={hasta} onChange={setHasta} min={desde || undefined} claseBoton="h-11 rounded-xl px-3 text-slate-800 md:h-10" className="min-w-0 md:w-[150px]" />
            </div>
          </BarraFiltros>
        </div>

        {conSaldo ? (
          !items.length ? vacio : (
            <TablaScroll primeraFija minAncho={900}>
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50/70 text-[11px] uppercase tracking-wider text-slate-500">
                  <tr>{columnas.map((c) => <th key={c.key} scope="col" className={`whitespace-nowrap px-3 py-3 font-semibold ${c.claseTh ?? ""}`}>{c.titulo}</th>)}</tr>
                </thead>
                <tbody className={`divide-y divide-slate-100 ${cargando ? "opacity-60" : ""}`}>
                  {items.map((m) => (
                    <tr key={m.id} className="align-top">
                      {columnas.map((c) => <td key={c.key} className={`px-3 py-3 ${c.claseTd ?? ""}`}>{c.celda(m)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TablaScroll>
          )
        ) : (
          <TablaTarjetas
            filas={items}
            columnas={columnas}
            claveFila={(m) => m.id}
            cargando={cargando}
            minAncho={900}
            vacio={vacio}
            claseTabla="w-full text-left text-sm"
            claseThead="bg-slate-50/70"
            thBase="whitespace-nowrap px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500"
            tdBase="px-3 py-3 align-top"
            claseFila={() => "hover:bg-[var(--brand-50)]"}
          />
        )}

        <Paginador pagina={pagina} porPagina={POR_PAGINA} total={total} cargando={cargando} onCambiar={(n) => setPagina(() => Math.max(1, Math.min(totalPaginas, n)))} />
      </section>
    </div>
  );
}
