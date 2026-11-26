"use client";

/**
 * /inventario — Inventario igual al de Ferretería República (sin rangos ABC):
 * exportar / importación inicial / importar Excel, filtros por categoría e inactivos,
 * paginado EN EL SERVIDOR con "Ir a", acciones editar · desactivar · eliminar.
 * Crear y editar siguen en el panel lateral del 2.0 (el listado queda visible atrás).
 */
import Link from "next/link";
import { unidadCorta } from "@/erp2/modules/inventario/recetas";
import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ALTO_MAX_MODAL, CapaModal } from "@/erp2/components/CapaModal";
import {
  ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Download, Eye, EyeOff, Loader2,
  MoreHorizontal, Package, Pencil, Plus, RotateCcw, Search, Trash2, Upload, Warehouse, X,
} from "lucide-react";
import { MenuAcciones } from "@/erp2/components/MenuAcciones";
import { depositosPlanos, hayVariosDepositos, invalidarDepositos, opcionesAlcance, opcionesDepositos, partesAlcance, useDepositos, type DepositoPlano } from "@/erp2/modules/inventario/depositos";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { apiFetchCache, invalidar } from "@/erp2/lib/api/cache-cliente";
import { tienePermiso, useFuncion, useUsuario } from "@/erp2/lib/sesion/ContextoUsuario";
import { MQ_MOVIL, useMediaQuery } from "@/erp2/lib/ui/responsive";
import { descargarArchivo } from "@/erp2/lib/api/client-blob";
import { clienteConfig } from "@/erp2/cliente.config";
import { Select } from "@/erp2/components/Select";
import { AccionesPagina, BarraFiltros, EncabezadoPagina } from "@/erp2/components/EncabezadoPagina";
import { TablaTarjetas, useVistaTarjetas, type ColumnaTabla } from "@/erp2/components/TablaResponsive";
import { colorCategoria, coloresPorCategoria, opcionesFiltroCategoria, partesCategoria, type Categoria, type ColorCategoria } from "@/erp2/modules/inventario/categorias";
import { invalidarLista, precargarLista, useListaCacheada } from "@/erp2/modules/inventario/lista-cache";
import { precargarFichaProducto } from "@/erp2/modules/inventario/ficha-cache";
import { TIPOS_PRODUCTO, tipoProducto, type ProductoInventario } from "@/erp2/modules/inventario/tipos";

// El panel del producto y el asistente de Excel se bajan recién cuando se usan (la
// pantalla carga menos JS); al pasar el mouse por "editar"/"nuevo" ya se precargan.
const cargarProductoForm = () => import("@/erp2/modules/inventario/ProductoForm");
const ProductoForm = dynamic(() => cargarProductoForm().then((m) => m.ProductoForm), { ssr: false });
const ExcelImportWizard = dynamic(() => import("@/erp2/modules/inventario/ExcelImportWizard").then((m) => m.ExcelImportWizard), { ssr: false });

const TEAL = clienteConfig.color;
const POR_PAGINA = [25, 50, 100, 200] as const;
type Pagina = { rows: ProductoInventario[]; total: number };

/** URL de una página del listado (misma forma siempre: es la clave del cache). */
/** Chip "Tipo": arranca en "De venta" (Reventa y Menú); las materias primas se eligen aparte. */
const OPCIONES_TIPO: [string, string][] = [
  ["", "De venta (Reventa y Menú)"],
  ...TIPOS_PRODUCTO.map((t): [string, string] => [t.id, t.id === "materia_prima" ? "Materias primas" : t.label]),
  ["todos", "Todos los tipos"],
];

/** Interruptor con aspecto de chip de la barra de filtros (mismo alto que los Select chip). */
const CHIP_TOGGLE = (on: boolean) =>
  `flex h-[38px] cursor-pointer select-none items-center gap-2 whitespace-nowrap rounded-xl border px-3 text-[13px] transition max-md:h-12 max-md:text-sm ${on ? "border-[color-mix(in_srgb,var(--brand)_38%,white)] bg-[var(--brand-50)] font-semibold text-[var(--brand)]" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`;

function urlPagina(f: { pagina: number; porPagina: number; busqueda: string; categoriaId: string; verInactivos: boolean; tipo: string }) {
  const sp = new URLSearchParams({ paginado: "1", pagina: String(f.pagina), por_pagina: String(f.porPagina) });
  if (f.busqueda) sp.set("q", f.busqueda);
  if (f.categoriaId) sp.set("categoria", f.categoriaId);
  if (f.verInactivos) sp.set("inactivos", "1");
  if (f.tipo) sp.set("tipo", f.tipo);
  return `/api/productos?${sp}`;
}

// Categorías ya vistas en esta pestaña: al volver a Inventario las etiquetas de categoría
// se pintan en el primer render (después se refrescan igual que antes).
let categoriasVistas: Categoria[] = [];

const gs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
const margenVenta = (costo: number, precio: number) => (precio ? ((precio - costo) / precio) * 100 : 0);
const margenColor = (m: number) => (m >= 40 ? "text-green-600" : m >= 20 ? "text-yellow-600" : "text-red-600");
const formatStock = (n: number) => Number(n).toLocaleString("es-PY", { maximumFractionDigits: 3 });

/** Stock que se muestra: el total, o el del depósito / la sucursal elegidos en "Stock". */
function stockMostrado(p: ProductoInventario, alcanceDeposito: string | null, alcanceSucursal: string | null, depPorId: Map<string, DepositoPlano>) {
  const porDep = p.stock_depositos ?? [];
  return alcanceDeposito
    ? porDep.find((x) => x.d === alcanceDeposito)?.c ?? 0
    : alcanceSucursal
      ? porDep.filter((x) => depPorId.get(x.d)?.sucursal_id === alcanceSucursal).reduce((a, x) => a + Number(x.c), 0)
      : Number(p.stock_actual);
}

export default function InventarioPage() {
  const me = useUsuario();
  // Perfil: importar productos pide "editar productos" (el costo lo oculta el servidor sin "ver costos").
  const esAdmin = tienePermiso(me, "editar_productos");
  const [categorias, setCategorias] = useState<Categoria[]>(categoriasVistas);
  const [recarga, setRecarga] = useState(0);

  // Filtros / paginado
  const [busquedaBorrador, setBusquedaBorrador] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [verInactivos, setVerInactivos] = useState(false);
  // Receta 72: filtro por tipo de producto (Reventa / Menú / Materia prima).
  const [tipo, setTipo] = useState("");
  // Receta 75: con Recetas apagada no hay filtro de tipo (ni chip de "Reventa"; los Menú / Materia prima que ya existan se siguen marcando).
  const conRecetas = useFuncion("recetas");
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState<number>(25);

  // Stock por depósito: "Ver stock de" (todos / una sucursal / un depósito) y la fila
  // expandida con las cantidades de cada depósito.
  const deps = useDepositos();
  const [alcance, setAlcance] = useState("");
  const [expandidos, setExpandidos] = useState<Set<string>>(() => new Set());
  const depPorId = useMemo(() => new Map(depositosPlanos(deps.datos).map((d) => [d.id, d])), [deps.datos]);
  const variosDepositos = hayVariosDepositos(deps.datos);
  const [depositoImportSel, setDepositoImport] = useState("");
  const depositoImport = depositoImportSel || deps.datos?.mi_deposito_id || "";
  const alcanceSel = useMemo(() => partesAlcance(alcance), [alcance]);
  // /inventario?deposito=<id> (desde Depósitos): arranca mirando ese depósito.
  useEffect(() => {
    const d = new URLSearchParams(window.location.search).get("deposito");
    if (d && /^[0-9a-f-]{36}$/i.test(d)) setAlcance(`d:${d}`);
  }, []);
  const toggleExpandido = useCallback((id: string) => setExpandidos((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  }), []);

  // Panel lateral (crear / editar) y modales
  const [form, setForm] = useState<{ open: boolean; prod: ProductoInventario | null }>({ open: false, prod: null });
  const [importando, setImportando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [eliminando, setEliminando] = useState<ProductoInventario | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Categorías: frescas al entrar (otras pantallas, como la importación inicial, pueden
  // haber creado nuevas); en las recargas tras cada edición salen del cache compartido.
  // Mientras tanto se pintan las últimas vistas (categoriasVistas).
  const primeraCarga = useRef(true);
  useEffect(() => {
    const fresco = primeraCarga.current;
    primeraCarga.current = false;
    apiFetchCache<{ categorias: Categoria[] }>("/api/inventario/categorias", { fresco })
      .then((r) => {
        categoriasVistas = [...r.categorias].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
        setCategorias(categoriasVistas);
      })
      .catch(() => {});
  }, [recarga]);

  // Debounce de la búsqueda (350 ms, como Ferretería). No dispara si el texto no cambió
  // (al montar, o espacios de más): así no se pide dos veces lo mismo.
  useEffect(() => {
    const texto = busquedaBorrador.trim();
    if (texto === busqueda) return;
    const t = setTimeout(() => {
      setBusqueda(texto);
      setPagina(1);
    }, 350);
    return () => clearTimeout(t);
  }, [busquedaBorrador, busqueda]);

  // Un solo request por combinación de filtros + página, cacheado: volver a una página ya
  // vista pinta al instante; mientras llega una nueva quedan las filas anteriores.
  // La lista arranca con lo que se vende (Reventa + Menú); las materias primas, con el chip Tipo.
  // Buscando por nombre se busca en todos los tipos (si no, "ajo" no aparecería).
  const tipoParam = !conRecetas ? "" : tipo === "todos" ? "" : tipo || (busqueda ? "" : "vendible");
  const filtros = { busqueda, categoriaId, verInactivos, porPagina, tipo: tipoParam };
  const url = urlPagina({ ...filtros, pagina });
  const { datos, cargando, error } = useListaCacheada<Pagina>(url, recarga);
  const productos = useMemo(() => (error ? [] : datos?.rows ?? []), [datos, error]);
  const total = error ? 0 : datos?.total ?? 0;

  const refrescar = useCallback(() => {
    // Editar un producto cambia también el kardex (ajuste de stock) y los lotes.
    invalidarLista("/api/inventario/movimientos");
    invalidarLista("/api/inventario/vencimientos");
    setRecarga((k) => k + 1);
  }, []);

  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));

  // Página siguiente precargada: "Siguiente" se siente instantáneo.
  const urlSiguiente = !cargando && !error && pagina < totalPaginas ? urlPagina({ ...filtros, pagina: pagina + 1 }) : null;
  useEffect(() => {
    if (!urlSiguiente) return;
    const t = setTimeout(() => precargarLista(urlSiguiente), 300);
    return () => clearTimeout(t);
  }, [urlSiguiente]);
  const paginaSegura = Math.min(pagina, totalPaginas);
  const desdeIdx = total === 0 ? 0 : (paginaSegura - 1) * porPagina + 1;
  const hastaIdx = Math.min(paginaSegura * porPagina, total);
  const categoriaPorId = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias]);
  const colores = useMemo(() => coloresPorCategoria(categorias), [categorias]);
  const hayFiltros = !!busqueda || !!categoriaId || (!!tipo && tipo !== "");

  // Callbacks estables para las filas memorizadas (FilaProducto).
  const toggleEnCurso = useRef(false);
  const toggleActivo = useCallback(async (p: ProductoInventario) => {
    if (toggleEnCurso.current) return;
    toggleEnCurso.current = true;
    setTogglingId(p.id);
    try {
      await apiFetch(`/api/productos/${p.id}`, { method: "PATCH", body: JSON.stringify({ activo: p.activo === false }) });
      refrescar();
    } catch {
      /* la fila queda igual; se puede reintentar */
    } finally {
      toggleEnCurso.current = false;
      setTogglingId(null);
    }
  }, [refrescar]);
  const abrirForm = useCallback((p: ProductoInventario | null) => setForm({ open: true, prod: p }), []);
  // Hover sobre "editar": se baja el JS del panel y se piden costos/lotes del producto.
  const precargarFicha = useCallback((p: ProductoInventario) => {
    void cargarProductoForm();
    precargarFichaProducto(p);
  }, []);

  async function exportar() {
    setExportando(true);
    try {
      await descargarArchivo("/api/inventario/productos/export", "productos.xlsx");
    } catch {
      /* best-effort */
    } finally {
      setExportando(false);
    }
  }

  function limpiarFiltros() {
    setBusquedaBorrador("");
    setBusqueda("");
    setCategoriaId("");
    setTipo("");
    setPagina(1);
  }

  const vistaTarjetas = useVistaTarjetas();
  const esMovil = useMediaQuery(MQ_MOVIL);
  // Tarjeta de producto (celular): nombre + SKU, precio arriba a la derecha, stock y categoría
  // como chips, costo y margen a la vista; stock por depósito plegado; acciones al pie.
  const columnasMovil = useMemo<ColumnaTabla<ProductoInventario>[]>(() => {
    // Renglón compacto: foto · nombre y precio · código, tipo y categoría en la línea gris · stock
    // a la derecha. Tocar abre la ficha; editar / desactivar / eliminar en "⋯". Costo y margen
    // quedan en la ficha (y en la tabla de compu).
    const cols: ColumnaTabla<ProductoInventario>[] = [
      {
        key: "foto", titulo: "", movil: "imagen",
        celda: (p) => (
          <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-slate-100 text-sm font-semibold text-slate-500">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {p.imagen_url ? <img src={p.imagen_url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" /> : p.nombre.charAt(0).toUpperCase()}
          </div>
        ),
      },
      {
        key: "producto", titulo: "Producto", movil: "titulo",
        celda: (p) => (
          <span>
            {p.nombre}
            {p.activo === false ? <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-amber-700">Inactivo</span> : null}
          </span>
        ),
      },
      { key: "precio", titulo: "Precio", movil: "valor", celda: (p) => (p.tipo_producto === "materia_prima" ? <span className="text-xs font-medium text-slate-400">No se vende</span> : gs(Number(p.precio_venta))) },
      {
        key: "stock", titulo: "Stock", movil: "chip",
        celda: (p) => {
          if (p.tipo_producto === "menu") return <span className="text-xs font-medium text-slate-500">Por receta</span>;
          if (p.controla_stock === false) return <span className="text-xs font-medium text-slate-500">{p.tipo_producto === "materia_prima" ? "Preparación" : "Sin control"}</span>;
          const stock = stockMostrado(p, alcanceSel.deposito, alcanceSel.sucursal, depPorId);
          const bajo = !alcanceSel.deposito && !alcanceSel.sucursal && Number(p.stock_minimo) > 0 && Number(p.stock_actual) < Number(p.stock_minimo);
          return (
            <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${bajo ? "bg-red-50 text-red-700 ring-1 ring-red-100" : stock > 0 ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100" : "bg-slate-50 text-slate-500 ring-1 ring-slate-200"}`}>
              {formatStock(stock)} <span className="text-[10px] font-normal opacity-80">{unidadCorta(p.unidad_medida ?? "Unidad")}</span>
            </span>
          );
        },
      },
      { key: "sku", titulo: "Código", movil: "subtitulo", celda: (p) => p.sku || null },
      { key: "tipo", titulo: "Tipo", movil: "dato", celda: (p) => (!conRecetas && (p.tipo_producto ?? "reventa") === "reventa" ? null : tipoProducto(p.tipo_producto).corto) },
      {
        key: "categoria", titulo: "Categoría", movil: "dato",
        celda: (p) => {
          const { madre, sub } = partesCategoria(p.categoria_principal_id, categoriaPorId);
          return madre ? `${madre.nombre}${sub ? ` › ${sub.nombre}` : ""}` : null;
        },
      },
      { key: "costo", titulo: "Costo", movil: "detalle", celda: (p) => (p.costo_promedio != null ? gs(Number(p.costo_promedio) || 0) : "—") },
      {
        key: "margen", titulo: "Margen", movil: "detalle",
        celda: (p) => {
          if (p.costo_promedio == null) return "—";
          const m = margenVenta(Number(p.costo_promedio) || 0, Number(p.precio_venta));
          return <span className={`font-semibold tabular-nums ${margenColor(m)}`}>{m.toFixed(1).replace(".", ",")} %</span>;
        },
      },
    ];    if (variosDepositos) {
      cols.push({
        key: "depositos", titulo: "Por depósito", movil: "detalle",
        celda: (p) => p.controla_stock === false || !(p.stock_depositos ?? []).length ? "—" : (
          <span className="flex flex-col items-end gap-1">
            {[...(p.stock_depositos ?? [])].sort((a, b) => Number(b.c) - Number(a.c)).map((x) => {
              const d = depPorId.get(x.d);
              return (
                <Link key={x.d} href={`/inventario/movimientos?producto=${p.id}&deposito=${x.d}`} className="inline-flex min-h-8 items-center gap-1.5 text-xs">
                  <span className="text-slate-500">{d ? (d.sucursal_principal && d.es_principal ? d.nombre : `${d.sucursal} › ${d.nombre}`) : "Depósito"}</span>
                  <strong className="tabular-nums text-slate-900">{formatStock(x.c)}</strong>
                </Link>
              );
            })}
          </span>
        ),
      });
    }
    cols.push({
      key: "acciones", titulo: "", movil: "acciones",
      celda: (p) => {
        const inactivo = p.activo === false;
        return (
          <MenuAcciones etiqueta={`Acciones de ${p.nombre}`} className="inline-flex items-center justify-center rounded-lg text-slate-400 active:bg-slate-100"
            items={[
              { etiqueta: inactivo ? "Ver" : "Editar", icono: inactivo ? <Eye className="h-4 w-4" /> : <Pencil className="h-4 w-4" />, onClick: () => abrirForm(p) },
              { etiqueta: inactivo ? "Reactivar" : "Desactivar", icono: inactivo ? <RotateCcw className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />, onClick: () => toggleActivo(p), tono: inactivo ? "exito" : "normal" },
              { etiqueta: "Eliminar", icono: <Trash2 className="h-4 w-4" />, onClick: () => setEliminando(p), tono: "peligro" },
            ]}>
            {togglingId === p.id ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <MoreHorizontal className="h-5 w-5" />}
          </MenuAcciones>
        );
      },
    });    return cols;
  }, [alcanceSel.deposito, alcanceSel.sucursal, depPorId, variosDepositos, categoriaPorId, colores, togglingId, abrirForm, toggleActivo, precargarFicha, conRecetas]);

  const opcionesCategoria: [string, string][] = [
    ["", "Todas las categorías"],
    ["__sin__", "— Sin categoría —"],
    ...opcionesFiltroCategoria(categorias),
  ];

  return (
    <div className="space-y-6 pb-10">
      {/* Encabezado. En celular: "Nuevo producto" a la vista; exportar e importar en el menú ⋯. */}
      <EncabezadoPagina
        volver={{ href: "/inventario/panel", label: "Inventario" }}
        kicker="Operaciones · Stock"
        titulo="Productos"
        subtitulo="Gestión de productos y control de stock"
        acciones={esMovil ? (
          <AccionesPagina acciones={[
            { etiqueta: "Nuevo producto", icono: <Plus />, onClick: () => abrirForm(null), primaria: true },
            { etiqueta: exportando ? "Generando..." : "Exportar Excel", icono: <Download />, onClick: exportar, cargando: exportando },
            ...(esAdmin ? [
              { etiqueta: "Importación inicial", href: "/inventario/import-inicial" },
              { etiqueta: "Importar Excel", icono: <Upload />, onClick: () => setImportando(true) },
            ] : []),
          ]} />
        ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={exportar} disabled={exportando} className="inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm font-semibold transition hover:bg-[var(--brand-50)] disabled:opacity-60" style={{ borderColor: `${TEAL}55`, color: TEAL }}>
            {exportando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {exportando ? "Generando..." : "Exportar Excel"}
          </button>
          {esAdmin ? (
            <>
              <Link href="/inventario/import-inicial" className="rounded-xl border-2 px-3 py-2 text-xs font-semibold transition hover:text-white" style={{ borderColor: `${TEAL}66`, backgroundColor: "var(--brand-50)", color: TEAL }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = TEAL; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--brand-50)"; }}>
                Importación inicial
              </Link>
              <button onClick={() => setImportando(true)} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                <Upload className="h-4 w-4" /> Importar Excel
              </button>
            </>
          ) : null}
        </div>
        )}
      />

      {/* Tarjeta principal */}
      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: `${TEAL}33` }}>
        <div className="flex flex-col gap-3 border-b p-4 sm:p-5" style={{ borderColor: `${TEAL}22`, background: `linear-gradient(to right, ${TEAL}0d, transparent)` }}>
          <div className="flex flex-wrap items-center gap-3">
            {/* El título "Productos" ya está arriba: acá solo la cantidad. */}
            <p className="text-sm text-slate-500">
              {cargando ? "Cargando…" : total === 0 ? "Sin resultados" : <>Mostrando <span className="font-semibold text-slate-700">{desdeIdx.toLocaleString("es-PY")}–{hastaIdx.toLocaleString("es-PY")}</span> de <span className="font-semibold text-slate-700">{total.toLocaleString("es-PY")}</span> {total === 1 ? "producto" : "productos"}</>}
            </p>
            <div className="ml-auto max-sm:hidden">
              <button onClick={() => abrirForm(null)} onMouseEnter={() => void cargarProductoForm()} onFocus={() => void cargarProductoForm()} className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:brightness-95 active:scale-95 max-md:min-h-11 max-md:px-4 max-md:text-sm" style={{ backgroundColor: TEAL }}>
                <Plus className="h-3.5 w-3.5" /> Nuevo producto
              </button>
            </div>
          </div>

          {/* Filtros: en celular, búsqueda + "Filtros (n)" (hoja inferior con el resto). */}
          <BarraFiltros
            plano
            activos={(categoriaId ? 1 : 0) + (tipo ? 1 : 0) + (alcance ? 1 : 0) + (verInactivos ? 1 : 0)}
            onLimpiar={() => { limpiarFiltros(); setAlcance(""); setVerInactivos(false); }}
            busqueda={
            <div className="relative lg:min-w-[240px] lg:flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={busquedaBorrador}
                onChange={(e) => setBusquedaBorrador(e.target.value)}
                placeholder="Buscar por nombre, SKU o código de barras..."
                type="search"
                enterKeyHint="search"
                aria-label="Buscar productos"
                className="h-11 w-full rounded-xl md:h-[38px] border border-slate-200 bg-white pl-9 pr-9 text-[13px] outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)] max-md:text-sm"
              />
              {busquedaBorrador ? (
                <button onClick={() => setBusquedaBorrador("")} aria-label="Limpiar búsqueda" className="absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 md:right-2 md:h-auto md:w-auto md:p-1">
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            }
          >
              <Select chip prefijo="Categoría" textoVacio="Todas" value={categoriaId} onChange={(v) => { setCategoriaId(v); setPagina(1); }} options={opcionesCategoria} minWidth={200} etiqueta="Categoría" className="max-w-[260px] max-md:max-w-none" />
              {conRecetas ? (
                <Select chip prefijo="Tipo" textoVacio="De venta" value={tipo} onChange={(v) => { setTipo(v); setPagina(1); }} options={OPCIONES_TIPO} minWidth={200} etiqueta="Tipo de producto" />
              ) : null}
              {variosDepositos ? (
                <Select chip prefijo="Stock" textoVacio="Todos los depósitos" value={alcance} onChange={setAlcance} options={opcionesAlcance(deps.datos, "Todos los depósitos")} minWidth={220} etiqueta="Ver stock de" />
              ) : null}
              <label className={CHIP_TOGGLE(verInactivos)} title="Mostrar también los productos inactivos (para reactivarlos)">
                <input type="checkbox" checked={verInactivos} onChange={(e) => { setVerInactivos(e.target.checked); setPagina(1); }} className="h-4 w-4 rounded border-slate-300 accent-[var(--brand)]" />
                Ver inactivos
              </label>
              <Select chip value={String(porPagina)} onChange={(v) => { setPorPagina(Number(v)); setPagina(1); }} options={POR_PAGINA.map((n): [string, string] => [String(n), `${n} por página`])} minWidth={130} etiqueta="Productos por página" />
          </BarraFiltros>

          {/* Los filtros activos ya se ven resaltados en sus chips (y "Limpiar filtros" en la barra). */}
        </div>

        {/* Lista: tarjetas en celular (< 768 px), la tabla de siempre desde tablet. */}
        {vistaTarjetas ? (
          <TablaTarjetas
            filas={productos}
            columnas={columnasMovil}
            claveFila={claveProducto}
            onFila={(p) => abrirForm(p)}
            cargando={cargando}
            vacio={
              <div className="px-5 py-14 text-center">
                {cargando ? (
                  <><Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /><p className="mt-2 text-xs text-slate-500">Cargando productos...</p></>
                ) : (
                  <><Package className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-medium text-slate-700">No se encontraron productos</p>
                  <p className="mt-1 text-xs text-slate-500">{hayFiltros ? "Probá con otra búsqueda o cambiá los filtros." : "Aún no cargaste productos. Empezá creando uno nuevo."}</p></>
                )}
              </div>
            }
          />
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr className="border-b-2 text-[11px] font-bold uppercase tracking-wider" style={{ borderColor: `${TEAL}26`, backgroundColor: `${TEAL}0d`, color: TEAL }}>
                <th className="px-5 py-3">Producto</th>
                <th className="hidden px-3 py-3 lg:table-cell">SKU</th>
                <th className="hidden px-3 py-3 md:table-cell">Categoría</th>
                <th className="px-3 py-3 text-right">Costo</th>
                <th className="px-3 py-3 text-right">Precio</th>
                <th className="px-3 py-3 text-center" title={alcance ? "Stock en lo elegido en «Stock»" : "Stock total (todos los depósitos)"}>
                  {alcance ? `Stock · ${alcanceSel.deposito ? depPorId.get(alcanceSel.deposito)?.nombre ?? "depósito" : "sucursal"}` : "Stock"}
                </th>
                <th className="hidden px-3 py-3 text-right lg:table-cell" title="Qué parte del precio de venta es ganancia: (precio − costo) ÷ precio">Margen</th>
                <th className="w-px px-5 py-3 text-center">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando && productos.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-16 text-center">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />
                    <p className="mt-2 text-xs text-slate-500">Cargando productos...</p>
                  </td>
                </tr>
              ) : productos.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-16 text-center">
                    <Package className="mx-auto h-8 w-8 text-slate-300" />
                    <p className="mt-3 text-sm font-medium text-slate-700">No se encontraron productos</p>
                    <p className="mt-1 text-xs text-slate-500">{hayFiltros ? "Probá con otra búsqueda o cambiá los filtros." : "Aún no cargaste productos. Empezá creando uno nuevo."}</p>
                  </td>
                </tr>
              ) : (
                productos.map((p) => (
                  <FilaProducto key={p.id} p={p} cargando={cargando} toggling={togglingId === p.id} categoriaPorId={categoriaPorId} colores={colores}
                    onEditar={abrirForm} onToggle={toggleActivo} onEliminar={setEliminando} onPrecargar={precargarFicha}
                    depPorId={depPorId} variosDepositos={variosDepositos} alcanceDeposito={alcanceSel.deposito} alcanceSucursal={alcanceSel.sucursal}
                    expandido={expandidos.has(p.id)} onExpandir={toggleExpandido} />
                ))
              )}
            </tbody>
          </table>
        </div>
        )}

        {/* Paginado */}
        {total > 0 ? (
          <div className="flex flex-wrap items-center justify-center gap-3 border-t-2 px-3 py-3 sm:justify-between sm:px-5" style={{ borderColor: `${TEAL}26`, background: `linear-gradient(to right, ${TEAL}0d, transparent)` }}>
            <p className="text-xs text-slate-500">
              Página <span className="font-semibold text-slate-900">{paginaSegura}</span> de <span className="font-semibold text-slate-900">{totalPaginas.toLocaleString("es-PY")}</span>
            </p>
            <div className="flex items-center gap-1">
              <BotonPag onClick={() => setPagina(1)} disabled={paginaSegura === 1} title="Primera página"><ChevronsLeft className="h-4 w-4" /></BotonPag>
              <BotonPag onClick={() => setPagina((x) => Math.max(1, x - 1))} disabled={paginaSegura === 1} title="Anterior"><ChevronLeft className="h-4 w-4" /></BotonPag>
              <div className="mx-1 flex items-center gap-1.5 text-xs text-slate-600">
                <span>Ir a</span>
                <input
                  type="number"
                  min={1}
                  max={totalPaginas}
                  value={paginaSegura}
                  onChange={(e) => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) setPagina(Math.max(1, Math.min(totalPaginas, n))); }}
                  inputMode="numeric"
                  aria-label="Ir a la página"
                  className="h-11 w-16 rounded-md border border-slate-200 bg-white px-2 text-center text-xs outline-none sm:h-8 focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-100)]"
                />
              </div>
              <BotonPag onClick={() => setPagina((x) => Math.min(totalPaginas, x + 1))} disabled={paginaSegura >= totalPaginas} title="Siguiente"><ChevronRight className="h-4 w-4" /></BotonPag>
              <BotonPag onClick={() => setPagina(totalPaginas)} disabled={paginaSegura >= totalPaginas} title="Última página"><ChevronsRight className="h-4 w-4" /></BotonPag>
            </div>
          </div>
        ) : null}
      </section>

      {form.open ? (
        <ProductoForm
          producto={form.prod}
          categorias={categorias}
          onClose={() => setForm({ open: false, prod: null })}
          onSaved={() => { setForm({ open: false, prod: null }); refrescar(); }}
        />
      ) : null}

      {importando ? (
        <ExcelImportWizard
          entidad="Productos"
          previewUrl="/api/inventario/productos/import/preview"
          commitUrl="/api/inventario/productos/import/commit"
          templateUrl="/api/inventario/productos/import/template"
          permiteCrearFaltantes
          camposExtra={depositoImport ? { deposito_id: depositoImport } : undefined}
          opcionesExtra={opcionesDepositos(deps.datos).length > 1 ? (
            <div className="max-w-sm">
              <span className="mb-1 block text-xs font-medium text-slate-600">La columna STOCK_ACTUAL es el stock de</span>
              <Select value={depositoImport} onChange={setDepositoImport} block options={opcionesDepositos(deps.datos)} />
              <p className="mt-1 text-[11px] text-slate-500">Las diferencias quedan en un ajuste de inventario (AJ-) de ese depósito. STOCK_ACTUAL vacío = el stock no se toca.</p>
            </div>
          ) : (
            <p className="text-[11px] text-slate-500">La columna STOCK_ACTUAL es el stock real: las diferencias quedan en un ajuste de inventario (AJ-). Vacía = el stock no se toca.</p>
          )}
          onClose={() => setImportando(false)}
          onCompleted={() => { invalidar("/api/inventario/categorias"); invalidarLista("/api/inventario/ajustes"); invalidarDepositos(); refrescar(); }}
        />
      ) : null}

      {eliminando ? <ConfirmarEliminar producto={eliminando} onClose={() => setEliminando(null)} onEliminado={() => { setEliminando(null); refrescar(); }} /> : null}
    </div>
  );
}

/**
 * Fila del listado, memorizada: escribir en el buscador (o abrir un modal) re-renderiza la
 * pantalla pero no las filas que no cambiaron. Las acciones llegan como callbacks estables.
 */
const FilaProducto = memo(function FilaProducto({
  p, cargando, toggling, categoriaPorId, colores, onEditar, onToggle, onEliminar, onPrecargar,
  depPorId, variosDepositos, alcanceDeposito, alcanceSucursal, expandido, onExpandir,
}: {
  p: ProductoInventario;
  cargando: boolean;
  toggling: boolean;
  categoriaPorId: Map<string, Categoria>;
  colores: Map<string, ColorCategoria>;
  onEditar: (p: ProductoInventario) => void;
  onToggle: (p: ProductoInventario) => void;
  onEliminar: (p: ProductoInventario) => void;
  onPrecargar: (p: ProductoInventario) => void;
  depPorId: Map<string, DepositoPlano>;
  variosDepositos: boolean;
  alcanceDeposito: string | null;
  alcanceSucursal: string | null;
  expandido: boolean;
  onExpandir: (id: string) => void;
}) {
  const costo = Number(p.costo_promedio) || 0;
  // Sin "ver costos y márgenes" el servidor no manda el costo: se muestra "—".
  const conCosto = p.costo_promedio != null;
  const porDep = p.stock_depositos ?? [];
  const stock = stockMostrado(p, alcanceDeposito, alcanceSucursal, depPorId);
  // Misma regla que el reporte de Stock mínimo: mínimo cargado y stock (total) por debajo.
  const stockBajo = Number(p.stock_minimo) > 0 && Number(p.stock_actual) < Number(p.stock_minimo);
  const margen = margenVenta(costo, Number(p.precio_venta));
  const sinControl = p.controla_stock === false;
  const { madre: catMadre, sub: catSub } = partesCategoria(p.categoria_principal_id, categoriaPorId);
  const inactivo = p.activo === false;
  const expandible = variosDepositos && !sinControl;
  return (
    <>
    <tr className={`transition-colors hover:bg-[var(--brand-50)] ${cargando ? "opacity-60" : ""} ${expandido ? "bg-[var(--brand-50)]/60" : ""}`}>
      <td className="px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-xs font-semibold text-slate-500">
            {p.imagen_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.imagen_url} alt="" className="h-full w-full object-cover" />
            ) : (
              p.nombre.charAt(0).toUpperCase()
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate font-bold text-slate-900">
              {p.nombre}
              {inactivo ? <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-amber-700">Inactivo</span> : null}
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[11px] text-slate-600 lg:hidden">{p.sku}</span>
              {p.tipo_producto && p.tipo_producto !== "reventa" ? <ChipTipo tipo={p.tipo_producto} /> : null}
            </p>
          </div>
        </div>
      </td>
      <td className="hidden px-3 py-3 font-mono text-xs text-slate-600 lg:table-cell">{p.sku}</td>
      <td className="hidden px-3 py-3 text-xs text-slate-600 md:table-cell">
        {catMadre ? (
          (() => {
            const c = colores.get(catMadre.id) ?? colorCategoria(catMadre.nombre);
            const ruta = catSub ? `${catMadre.nombre} › ${catSub.nombre}` : catMadre.nombre;
            return (
              <span className="inline-flex max-w-full items-center gap-1.5 truncate whitespace-nowrap rounded-md border border-slate-200/70 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.04)]" title={ruta}>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c.dot, boxShadow: `0 0 0 3px ${c.bg}` }} />
                <span className="truncate">
                  {catMadre.nombre}
                  {catSub ? <span className="font-medium text-slate-500"> › {catSub.nombre}</span> : null}
                </span>
              </span>
            );
          })()
        ) : (
          <span className="text-slate-400">— Sin categoría</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-slate-700">{conCosto ? gs(costo) : <span className="text-slate-300">—</span>}</td>
      <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums text-slate-900">{p.tipo_producto === "materia_prima" ? <span className="text-xs font-medium text-slate-400">No se vende</span> : gs(Number(p.precio_venta))}</td>
      <td className="px-3 py-3 text-center">
        {sinControl ? (
          <span className="text-xs font-medium text-slate-500">{p.tipo_producto === "menu" ? "— por receta" : p.tipo_producto === "materia_prima" ? "— preparación" : "— sin control"}</span>
        ) : (
          <button type="button" disabled={!expandible} onClick={() => onExpandir(p.id)}
            title={expandible ? (expandido ? "Ocultar el stock por depósito" : "Ver el stock por depósito") : undefined}
            aria-expanded={expandible ? expandido : undefined}
            className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums transition ${expandible ? "cursor-pointer hover:brightness-95" : "cursor-default"} ${!alcanceDeposito && !alcanceSucursal && stockBajo ? "bg-red-50 text-red-700 ring-1 ring-red-100" : stock > 0 ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100" : "bg-slate-50 text-slate-500 ring-1 ring-slate-200"}`}>
            {formatStock(stock)}
            <span className="text-[10px] font-normal opacity-80">{unidadCorta(p.unidad_medida ?? "Unidad")}</span>
            {expandible ? <ChevronDown className={`h-3 w-3 opacity-70 transition-transform ${expandido ? "rotate-180" : ""}`} /> : null}
          </button>
        )}
      </td>
      <td className={`hidden px-3 py-3 text-right font-semibold tabular-nums lg:table-cell ${conCosto && p.tipo_producto !== "materia_prima" ? margenColor(margen) : "text-slate-300"}`}>{conCosto && p.tipo_producto !== "materia_prima" ? `${margen.toFixed(1).replace(".", ",")} %` : "—"}</td>
      <td className="px-5 py-3">
        <div className="flex items-center justify-center gap-1">
          <button onClick={() => onEditar(p)} onMouseEnter={() => onPrecargar(p)} onFocus={() => onPrecargar(p)} title={inactivo ? "Ver producto (inactivo)" : "Editar producto"} aria-label={`${inactivo ? "Ver" : "Editar"} ${p.nombre}`} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-[var(--brand-50)] hover:text-[var(--brand)]">
            {inactivo ? <Eye className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
          </button>
          <button onClick={() => onToggle(p)} disabled={toggling} title={inactivo ? "Reactivar producto" : "Desactivar producto (reversible)"} aria-label={`${inactivo ? "Reactivar" : "Desactivar"} ${p.nombre}`}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition disabled:opacity-40 ${inactivo ? "text-emerald-600 hover:bg-emerald-50" : "text-slate-500 hover:bg-amber-50 hover:text-amber-600"}`}>
            {toggling ? <Loader2 className="h-4 w-4 animate-spin" /> : inactivo ? <RotateCcw className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </button>
          <button onClick={() => onEliminar(p)} title="Eliminar producto (permanente)" aria-label={`Eliminar ${p.nombre}`} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-red-50 hover:text-red-600">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
    {expandible && expandido ? (
      <tr className="bg-[var(--brand-50)]/40">
        <td colSpan={8} className="px-5 pb-3 pt-0">
          <div className="flex flex-wrap items-center gap-2 pl-11">
            <Warehouse className="h-3.5 w-3.5 text-slate-400" />
            {porDep.length === 0 ? (
              <span className="text-xs text-slate-500">Sin unidades en ningún depósito.</span>
            ) : (
              [...porDep]
                .sort((a, b) => Number(b.c) - Number(a.c))
                .map((x) => {
                  const d = depPorId.get(x.d);
                  return (
                    <Link key={x.d} href={`/inventario/movimientos?producto=${p.id}&deposito=${x.d}`} title="Ver el kardex en este depósito"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs shadow-sm transition hover:border-[var(--brand)]">
                      <span className="text-slate-500">{d ? (d.sucursal_principal && d.es_principal ? d.nombre : `${d.sucursal} › ${d.nombre}`) : "Depósito"}</span>
                      <strong className="tabular-nums text-slate-900">{formatStock(x.c)}</strong>
                    </Link>
                  );
                })
            )}
          </div>
        </td>
      </tr>
    ) : null}
    </>
  );
});

const claveProducto = (p: ProductoInventario) => p.id;

/** Chip del tipo de producto (receta 72). */
function ChipTipo({ tipo }: { tipo?: string | null }) {
  const t = tipoProducto(tipo);
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${t.chip}`}>{t.corto}</span>;
}

function BotonPag({ children, onClick, disabled, title }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} aria-label={title}
      className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition sm:h-8 sm:w-8 hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:border-slate-100 disabled:bg-slate-50 disabled:text-slate-300">
      {children}
    </button>
  );
}

function ConfirmarEliminar({ producto, onClose, onEliminado }: { producto: ProductoInventario; onClose: () => void; onEliminado: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function eliminar() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/productos/${producto.id}`, { method: "DELETE" });
      onEliminado();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <CapaModal onClose={busy ? undefined : onClose} z="z-[120]" fondo="bg-slate-900/40 backdrop-blur-sm">
        <div className={`flex w-full max-w-sm ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/5`} onClick={(e) => e.stopPropagation()} style={{ animation: "rb-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
          <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col items-center px-6 pb-2 pt-7">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 ring-4 ring-rose-50/60">
              <Trash2 className="h-5 w-5 text-rose-600" />
            </div>
            <h3 className="mt-4 text-center text-base font-semibold tracking-tight text-slate-900">¿Eliminar este producto?</h3>
            <p className="mt-1.5 text-center text-[13px] leading-relaxed text-slate-500">
              Se borra de la base de forma <strong>permanente</strong>. Esta acción no se puede deshacer. Si tiene ventas o movimientos de stock registrados, no se podrá eliminar: en ese caso, desactivalo.
            </p>
          </div>
          <div className="mx-6 mt-3 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
            <p className="truncate text-[13px] font-semibold text-slate-900">{producto.nombre}</p>
            {producto.sku ? <p className="mt-0.5 text-[11px] uppercase tracking-wider text-slate-400">SKU <span className="font-mono text-slate-500">{producto.sku}</span></p> : null}
          </div>
          {error ? <div className="mx-6 mt-3 rounded-lg border border-rose-100 bg-rose-50/70 px-3 py-2 text-[12px] text-rose-700">{error}</div> : null}
          <div className="h-5" />
          </div>
          <div className="flex shrink-0 gap-2 border-t border-slate-100 bg-slate-50/40 px-5 py-3">
            <button onClick={onClose} disabled={busy} className="flex-1 rounded-lg border-2 border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
            <button onClick={eliminar} disabled={busy} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 active:scale-[0.98] disabled:opacity-60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              {busy ? "Eliminando..." : "Eliminar"}
            </button>
          </div>
        </div>
    </CapaModal>
  );
}
