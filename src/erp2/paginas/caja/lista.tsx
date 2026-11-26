"use client";

/**
 * Caja › Órdenes de venta: las ventas (contado y crédito) con filtros por sucursal, caja,
 * forma de pago, condición, IVA, estado y fechas (el producto se busca con el buscador).
 * Nueva venta y las cajas abiertas están en el panel de Caja; las ventas a crédito, en Reportes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { BarraFiltros, EncabezadoPagina } from "@/erp2/components/EncabezadoPagina";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { clienteConfig } from "@/erp2/cliente.config";
import { Select } from "@/erp2/components/Select";
import { VentaDetalle } from "@/erp2/modules/caja/VentaDetalle";
import { TablaTarjetas } from "@/erp2/components/TablaResponsive";
import { formatGs } from "@/erp2/modules/caja/lib";
import { metodoLabel, invalidarCajas, METODOS_VENTA, useEstadoCajas, type EstadoCajas } from "@/erp2/modules/caja/turno";
import { rangoAtajo, SelectorPeriodo, ATAJO_LABEL, type Atajo } from "@/erp2/modules/reportes/ui";
import { fechaHora, hoyPY } from "@/erp2/lib/fecha/paraguay";

const TEAL = clienteConfig.color;
const OPCIONES_PERIODO: [string, string][] = (["todo", "hoy", "semana", "mes", "mes_anterior", "3m", "anio"] as Atajo[]).map((k) => [k, k === "todo" ? "Todas las fechas" : ATAJO_LABEL[k]]);
const fechaVenta = (iso: string) => fechaHora(iso);

// Suma de cantidades con coma decimal (máx. 3): "1,5" y no "1.0000339999999999".
const cantTotal = (items: { cantidad: number }[]) =>
  items.reduce((a, i) => a + Number(i.cantidad), 0).toLocaleString("es-PY", { maximumFractionDigits: 3 });

type VentaItem = { producto_nombre: string; sku?: string | null; cantidad: number; tipo_iva: string };
type Venta = {
  id: string;
  numero_control: string;
  fecha: string;
  total: number;
  tipo_venta: string;
  estado: string;
  metodo_pago: string | null;
  usuario_nombre: string | null;
  ventas_items: VentaItem[];
  pagos: { metodo_pago: string; monto: number }[] | null;
  punto: { nombre: string } | null;
  sucursal: { nombre: string } | null;
};

export default function CajaDashboard() {
  // Al anular una venta se recargan las cajas abiertas (ventas y total del turno).
  const [recargaCajas, setRecargaCajas] = useState(0);
  const { datos } = useEstadoCajas(recargaCajas);
  return (
    <div className="space-y-4 pb-10 sm:space-y-6">
      <EncabezadoPagina volver={{ href: "/caja/panel", label: "Caja" }} kicker="Caja" titulo="Órdenes de venta" subtitulo="Todas las ventas de las cajas, con su forma de pago" />

      <Ordenes cajas={datos} onAnulada={() => { invalidarCajas(); setRecargaCajas((n) => n + 1); }} />
    </div>
  );
}

// ── Órdenes de venta ──────────────────────────────────────────────────────────

function Ordenes({ cajas, onAnulada }: { cajas: EstadoCajas | null; onAnulada: () => void }) {
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [total, setTotal] = useState(0); // ventas que cumplen los filtros
  const [totalGeneral, setTotalGeneral] = useState(0); // ventas sin filtrar
  const [buscando, setBuscando] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [q, setQ] = useState(""); // búsqueda con debounce (la que va al servidor)
  const [tipo, setTipo] = useState("");
  const [iva, setIva] = useState("");
  const [estado, setEstado] = useState("");
  const [sucursal, setSucursal] = useState("");
  const [punto, setPunto] = useState("");
  const [metodo, setMetodo] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  // Período: como los reportes (atajos o rango); "Todo" = sin filtro de fechas.
  const [atajo, setAtajo] = useState<string | null>("todo");
  const [viendo, setViendo] = useState<string | null>(null);
  // Paginado EN EL SERVIDOR: solo viaja la página visible (antes se bajaba todo el historial).
  const [porPagina, setPorPagina] = useState(25);
  const [pagina, setPagina] = useState(1);
  const pedido = useRef(0); // descarta respuestas viejas si el usuario sigue tipeando/filtrando
  // Filtros de la última respuesta con totales: si solo cambia la página, no se recuenta.
  const contados = useRef<string | null>(null);

  // Al cambiar lo que se filtra o el tamaño de página se vuelve a la primera EN EL MISMO
  // cambio de estado (antes un efecto aparte lo hacía después → dos pedidos al servidor).
  const conPagina1 = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPagina(1); };

  // Debounce de la búsqueda: no pegarle al servidor en cada tecla.
  useEffect(() => {
    const t = setTimeout(() => {
      const nueva = busqueda.trim();
      if (nueva !== q) { setQ(nueva); setPagina(1); }
    }, 300);
    return () => clearTimeout(t);
  }, [busqueda, q]);

  const cargar = useCallback((recontar = false) => {
    const sp = new URLSearchParams({ pagina: String(pagina), por_pagina: String(porPagina) });
    if (q) sp.set("q", q);
    if (tipo) sp.set("tipo", tipo);
    if (iva) sp.set("iva", iva);
    if (estado) sp.set("estado", estado);
    if (sucursal) sp.set("sucursal", sucursal);
    if (punto) sp.set("punto", punto);
    if (metodo) sp.set("metodo", metodo);
    if (desde) sp.set("desde", desde);
    if (hasta) sp.set("hasta", hasta);
    const firma = JSON.stringify([porPagina, q, tipo, iva, estado, desde, hasta, sucursal, punto, metodo]);
    if (!recontar && contados.current === firma) sp.set("contar", "0");
    const n = ++pedido.current;
    setBuscando(true);
    apiFetch<{ rows: Venta[]; total: number | null; total_general: number | null }>(`/api/ventas?${sp}`)
      .then((r) => {
        if (n !== pedido.current) return;
        setVentas(r.rows);
        if (r.total != null) {
          setTotal(r.total);
          setTotalGeneral(r.total_general ?? r.total);
          contados.current = firma;
        }
      })
      .catch(() => { if (n === pedido.current) { setVentas([]); setTotal(0); contados.current = null; } })
      .finally(() => { if (n === pedido.current) setBuscando(false); });
  }, [pagina, porPagina, q, tipo, iva, estado, desde, hasta, sucursal, punto, metodo]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const filtrosActivos = (tipo ? 1 : 0) + (iva ? 1 : 0) + (estado ? 1 : 0) + (desde || hasta ? 1 : 0) +
    (sucursal ? 1 : 0) + (punto ? 1 : 0) + (metodo ? 1 : 0);
  // Opciones de sucursal y caja (las que ve el usuario).
  const sucursalesOpts = useMemo<[string, string][]>(
    () => [["", "Todas las sucursales"], ...(cajas?.sucursales ?? []).map((s): [string, string] => [s.id, s.nombre])],
    [cajas],
  );
  const cajasOpts = useMemo<[string, string][]>(
    () => [["", "Todas las cajas"], ...(cajas?.sucursales ?? [])
      .filter((s) => !sucursal || s.id === sucursal)
      .flatMap((s) => s.cajas.map((c): [string, string] => [c.id, `${c.nombre} · ${s.nombre}`]))],
    [cajas, sucursal],
  );

  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  const paginaActual = Math.min(pagina, totalPaginas);
  const inicio = (paginaActual - 1) * porPagina;
  const visibles = ventas;

  const limpiar = () => { setTipo(""); setIva(""); setEstado(""); setAtajo("todo"); setDesde(""); setHasta(""); setSucursal(""); setPunto(""); setMetodo(""); setPagina(1); };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 sm:mb-4">
        <div className="flex items-center gap-2">
          <span className="block h-5 w-1 rounded-full" style={{ backgroundColor: TEAL }} />
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">Ventas</h2>
        </div>
        <span className={`text-xs text-slate-400 transition-opacity sm:text-sm ${buscando ? "opacity-50" : ""}`}>{total.toLocaleString("es-PY")} de {totalGeneral.toLocaleString("es-PY")} ventas</span>
      </div>

      {/* Filtros: chips del mismo alto (como Inventario y los reportes); en celular, búsqueda +
          "Filtros (n)" con el resto en una hoja inferior. */}
      <div className="mb-3 border-b border-slate-100 pb-3 sm:mb-5 sm:pb-4">
        <BarraFiltros
          plano
          activos={filtrosActivos}
          onLimpiar={limpiar}
          busqueda={
            <div className="relative lg:min-w-[240px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar número, producto, SKU, monto…"
                type="search" enterKeyHint="search" aria-label="Buscar ventas"
                className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-9 text-[13px] text-slate-700 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)] max-md:text-sm md:h-[38px]"
              />
              {busqueda ? (
                <button type="button" onClick={() => setBusqueda("")} aria-label="Limpiar búsqueda" className="absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 md:right-2 md:h-auto md:w-auto md:p-1">
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          }
        >
          <SelectorPeriodo atajos={OPCIONES_PERIODO} atajo={atajo}
            onAtajo={(k) => { const r = rangoAtajo(k as Atajo); setAtajo(k); setDesde(r.desde); setHasta(r.hasta); setPagina(1); }}
            desde={desde} hasta={hasta} maxHasta={hoyPY()}
            onRango={(d, h) => { setAtajo(null); setDesde(d); setHasta(h); setPagina(1); }} />
          {sucursalesOpts.length > 2 ? (
            <Select chip prefijo="Sucursal" textoVacio="Todas" value={sucursal} onChange={conPagina1((v: string) => { setSucursal(v); setPunto(""); })} options={sucursalesOpts} minWidth={200} etiqueta="Sucursal" />
          ) : null}
          <Select chip prefijo="Caja" textoVacio="Todas" value={punto} onChange={conPagina1(setPunto)} options={cajasOpts} minWidth={210} etiqueta="Caja" />
          <Select chip prefijo="Condición" textoVacio="Todas" value={tipo} onChange={conPagina1(setTipo)} options={[["", "Contado y crédito"], ["CONTADO", "Contado"], ["CREDITO", "Crédito"]]} minWidth={170} etiqueta="Condición" />
          <Select chip prefijo="Pago" textoVacio="Todos" value={metodo} onChange={conPagina1(setMetodo)} minWidth={200} etiqueta="Forma de pago"
            options={[["", "Todas las formas de pago"], ...METODOS_VENTA.map((m): [string, string] => [m.value, m.label]), ["mixto", "Pago mixto"]]} />
          <Select chip prefijo="IVA" textoVacio="Todos" value={iva} onChange={conPagina1(setIva)} options={[["", "Todos los IVA"], ["10%", "IVA 10%"], ["5%", "IVA 5%"], ["EXENTA", "Exenta"]]} minWidth={150} etiqueta="IVA" />
          <Select chip prefijo="Estado" textoVacio="Todos" value={estado} onChange={conPagina1(setEstado)} options={[["", "Todos los estados"], ["completada", "Completada"], ["anulada", "Anulada"]]} minWidth={170} etiqueta="Estado" />
          <Select chip value={String(porPagina)} onChange={conPagina1((v: string) => setPorPagina(Number(v)))} options={[["25", "25 por página"], ["50", "50 por página"], ["100", "100 por página"]]} minWidth={130} etiqueta="Ventas por página" />
        </BarraFiltros>
      </div>
      {/* Celular: cada venta es una tarjeta (producto, número y fecha, total; condición y caja). */}
      <TablaTarjetas
        filas={visibles}
        claveFila={(v) => v.id}
        onFila={(v) => setViendo(v.id)}
        claseFila={(v) => (v.estado === "anulada" ? "opacity-50" : "")}
        claseTabla="w-full text-left text-sm"
        claseThead="bg-slate-50"
        minAncho={1120}
        thBase="whitespace-nowrap px-2.5 py-2.5 text-xs font-semibold text-slate-500"
        tdBase="px-2.5 py-2"
        vacio={<p className="py-12 text-center text-sm text-slate-400">{buscando ? "Buscando…" : totalGeneral === 0 ? "No hay ventas registradas" : "Ninguna venta coincide con los filtros"}</p>}
        columnas={[
          { key: "num", titulo: "Número", claseTd: "whitespace-nowrap font-mono text-xs text-slate-500", movil: "subtitulo",
            celda: (v) => v.numero_control,
            // Celular: número · fecha · forma de pago en la línea gris.
            celdaMovil: (v) => <>{v.numero_control} · {fechaVenta(v.fecha).replace(/\/\d{4},?/, "")}{v.tipo_venta !== "CREDITO" ? ` · ${(v.pagos ?? []).length ? [...new Set((v.pagos ?? []).map((pg) => metodoLabel(pg.metodo_pago)))].join(" + ") : metodoLabel(v.metodo_pago)}` : ""}</> },
          { key: "prod", titulo: "Productos", movil: "titulo",
            celda: (v) => {
              const items = v.ventas_items ?? [];
              const primero = items[0];
              // Un solo renglón: el código y el detalle están en la venta.
              return (
                <span className="flex max-w-[210px] items-baseline gap-1.5" title={items.map((i) => i.producto_nombre).join(", ")}>
                  <span className="min-w-0 truncate font-normal text-slate-800">{primero?.producto_nombre ?? "—"}</span>
                  {items.length > 1 ? <span className="shrink-0 text-xs font-normal text-slate-400">+{items.length - 1} más</span> : null}
                </span>
              );
            },
            celdaMovil: (v) => {
              const items = v.ventas_items ?? [];
              return (
                <>
                  <span className="block">{items[0]?.producto_nombre ?? "—"}{items.length > 1 ? <span className="font-normal text-slate-400"> +{items.length - 1} más</span> : null}</span>
                </>
              );
            } },
          { key: "items", titulo: "Ítems", claseTh: "text-center", claseTd: "text-center", movil: "oculto",
            celda: (v) => <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{(v.ventas_items ?? []).length}</span>,
            celdaMovil: (v) => { const it = v.ventas_items ?? []; return `${it.length} · ${cantTotal(it)} u`; } },
          { key: "cant", titulo: "Cant. total", claseTh: "text-right", claseTd: "text-right tabular-nums text-slate-700", movil: "oculto",
            celda: (v) => cantTotal(v.ventas_items ?? []) },
          { key: "iva", titulo: "IVA", movil: "detalle",
            celda: (v) => { const ivas = [...new Set((v.ventas_items ?? []).map((i) => i.tipo_iva))]; return <span className="whitespace-nowrap rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">{ivas.length === 1 ? `IVA ${ivas[0]}` : "Varios"}</span>; } },
          { key: "total", titulo: "Total", claseTh: "text-right", claseTd: "whitespace-nowrap text-right font-semibold tabular-nums text-slate-800", movil: "valor", celda: (v) => formatGs(v.total) },
          { key: "cond", titulo: "Tipo de pago", movil: "chip",
            // Celular: solo lo que no es lo habitual (crédito o anulada); "Contado" no se repite en cada renglón.
            celdaMovil: (v) => (v.tipo_venta === "CREDITO" || v.estado === "anulada" ? (
              <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={v.estado === "anulada" ? { backgroundColor: "#fff1f2", color: "#e11d48" } : { backgroundColor: "#fff7ed", color: "#ea580c" }}>
                {v.estado === "anulada" ? "Anulada" : "Crédito"}
              </span>
            ) : null),
            celda: (v) => (
              <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold" style={v.tipo_venta === "CREDITO" ? { backgroundColor: "#fff7ed", color: "#ea580c" } : { backgroundColor: "#f1f5f9", color: "#475569" }}>
                {v.tipo_venta === "CREDITO" ? "Crédito" : "Contado"}{v.estado === "anulada" ? " · anulada" : ""}
              </span>
            ) },
          // Celular: ya va en la línea gris, junto al número.
          { key: "modo", titulo: "Modo de pago", claseTd: "text-xs text-slate-600", movil: "oculto",
            celda: (v) => (v.tipo_venta === "CREDITO" ? <span className="text-slate-400">—</span> : (
              <span className="block max-w-[120px] truncate" title={(v.pagos ?? []).map((pg) => `${metodoLabel(pg.metodo_pago)} ${formatGs(pg.monto)}`).join(" + ")}>
                {(v.pagos ?? []).length ? [...new Set((v.pagos ?? []).map((pg) => metodoLabel(pg.metodo_pago)))].join(" + ") : metodoLabel(v.metodo_pago)}
              </span>
            )) },
          { key: "caja", titulo: "Caja", claseTd: "whitespace-nowrap text-xs text-slate-600", movil: "detalle",
            celda: (v) => <span className="block max-w-[130px] truncate" title={[v.punto?.nombre, v.sucursal?.nombre].filter(Boolean).join(" · ")}>{v.punto?.nombre ?? "—"}{v.sucursal?.nombre ? <span className="text-slate-400"> · {v.sucursal.nombre}</span> : null}</span> },
          { key: "usuario", titulo: "Usuario", claseTd: "text-xs text-slate-600", movil: "oculto",
            celda: (v) => <span className="block max-w-[100px] truncate" title={v.usuario_nombre ?? undefined}>{v.usuario_nombre ?? "—"}</span> },
          { key: "fecha", titulo: "Fecha", claseTd: "whitespace-nowrap text-xs tabular-nums text-slate-500", movil: "oculto", celda: (v) => fechaVenta(v.fecha) },
        ]}
      />

      {/* Paginado */}
      {total > 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <span className="text-sm text-slate-500">
            Mostrando <strong className="font-semibold text-slate-700">{inicio + 1}–{Math.min(inicio + porPagina, total)}</strong> de{" "}
            <strong className="font-semibold text-slate-700">{total.toLocaleString("es-PY")}</strong>
          </span>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPagina((p) => Math.max(1, p - 1))}
                disabled={paginaActual <= 1}
                aria-label="Página anterior"
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 sm:h-9 sm:w-9"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-[110px] text-center text-sm tabular-nums text-slate-600">
                Página <strong className="font-semibold text-slate-800">{paginaActual}</strong> de {totalPaginas}
              </span>
              <button
                type="button"
                onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
                disabled={paginaActual >= totalPaginas}
                aria-label="Página siguiente"
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 sm:h-9 sm:w-9"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {viendo ? (
        <VentaDetalle ventaId={viendo} onClose={() => setViendo(null)} onAnulada={() => { setViendo(null); cargar(true); onAnulada(); }} onCambio={() => cargar(true)} />
      ) : null}
    </section>
  );
}

