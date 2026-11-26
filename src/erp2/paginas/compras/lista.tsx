"use client";

/**
 * /gastos-empresariales/compras-gastos — "Compras y gastos": UNA lista con las compras de
 * mercadería, los gastos y las compras mixtas (receta 59), más los gastos operativos cargados
 * antes de la unificación y los borradores que generan los recurrentes.
 *   · Tipo: Todas / Mercadería / Gasto / Mixta (1 toque). Período (mes actual por defecto),
 *     sucursal, estado y condición; buscador preciso (número COMP-/GS- exacto, N° de factura,
 *     monto, RUC, proveedor, productos, categorías y descripciones de gasto).
 *   · Filtros que llegan por URL (desde el Resumen o las rutas viejas) como chips que se quitan:
 *     proveedor (?proveedor=&nombre=), categoría, fijo/variable, IVA, origen, "con gasto".
 *   · Tocar una fila abre su detalle: compra → DetalleCompra (líneas por tipo, pagos, anular);
 *     gasto anterior → DetalleGasto (anular, o abrir y confirmar el borrador).
 *   · ?ver=<compra> y ?gasto=<gasto> abren el detalle (links de Pagos, reportes, kardex…).
 * Reemplaza a las pestañas "Gastos operativos" y "Compras": /compras y
 * /gastos-empresariales/operativos redirigen acá con el filtro que corresponde.
 */
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarClock, FolderCog, Package, Paperclip, Pencil, Plus, Receipt, Search, Trash2, X } from "lucide-react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { apiFetchCache } from "@/erp2/lib/api/cache-cliente";
import { hoyPY } from "@/erp2/lib/fecha/paraguay";
import { Select } from "@/erp2/components/Select";
import { SelectorFecha } from "@/erp2/components/SelectorFecha";
import { AccionesPagina, BarraFiltros, EncabezadoPagina } from "@/erp2/components/EncabezadoPagina";
import { TablaTarjetas, type ColumnaTabla } from "@/erp2/components/TablaResponsive";
import { DetalleCompra } from "@/erp2/modules/compras/DetalleCompra";
import { TIPO_COMPRA, type TipoCompra } from "@/erp2/modules/compras/tipos";
import { FormGasto } from "@/erp2/modules/gastos/FormGasto";
import { ConfirmarAccionGasto, DetalleGasto } from "@/erp2/modules/gastos/DetalleGasto";
import { CatalogosGastos } from "@/erp2/modules/gastos/Catalogos";
import { URL_CATALOGOS, fechaCorta, gs, monto, nombreMedioGasto, type Catalogos, type Moneda } from "@/erp2/modules/gastos/tipos";

const RUTA = "/compras"; // Neura: la lista de compras vive en /compras
const POR_PAGINA = 50;
const INPUT = "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition hover:border-slate-300 focus:border-[var(--brand-400)] focus:ring-2 focus:ring-[var(--brand-400)]/20";
const UUID = /^[0-9a-f-]{36}$/i;
const primeroDelMes = () => `${hoyPY().slice(0, 8)}01`;
/** Fin del mes actual: incluye los borradores programados de los próximos días. */
const finDelMes = () => { const [y, m] = hoyPY().split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

type Estado = "vigente" | "borrador" | "anulado";
type Fila = {
  origen: "compra" | "gasto";
  id: string;
  numero: string | null;
  estado: Estado;
  tipo: TipoCompra;
  fecha: string;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  con_comprobante: boolean;
  tipo_comprobante: string | null;
  comprobante: string | null;
  tipo_pago: "contado" | "credito" | null;
  medio_pago: string | null;
  vencimiento: string | null;
  moneda: Moneda;
  total: number;
  total_gs: number;
  total_mercaderia: number;
  total_gastos: number;
  descripcion: string | null;
  sucursal_nombre: string | null;
  productos: number;
  categorias: string | null;
  cxp: { id: string; saldo: number; pagado: number; estado: string; moneda: Moneda } | null;
  oc_numero: string | null;
  adjuntos: number;
  recurrente_id: string | null;
  fecha_programada: string | null;
  anulado_motivo: string | null;
};
type Lista = {
  rows: Fila[]; total: number; total_monto: number; total_mercaderia: number; total_gastos: number;
  total_iva: number; total_borradores: number; borradores: number;
};
type Filtros = {
  tipo: string; estado: string; desde: string; hasta: string; sucursal: string; proveedor: string; categoria: string;
  tipo_costo: string; deducible: string; origen: string; tipo_pago: string;
};

const TIPOS: [string, string][] = [["", "Todas"], ["mercaderia", "Mercadería"], ["gasto", "Gasto"], ["mixta", "Mixta"]];
const ESTADO: Record<Estado, { t: string; c: string }> = {
  vigente: { t: "Vigente", c: "bg-emerald-50 text-emerald-700" },
  borrador: { t: "Borrador", c: "bg-slate-100 text-slate-600" },
  anulado: { t: "Anulado", c: "bg-rose-50 text-rose-600" },
};

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ComprasYGastos />
    </Suspense>
  );
}

function filtrosDeUrl(sp: URLSearchParams): Filtros {
  const v = (k: string) => sp.get(k) ?? "";
  const tieneFechas = sp.has("desde") || sp.has("hasta");
  const estado = v("estado") === "confirmado" ? "vigente" : v("estado");
  return {
    tipo: ["mercaderia", "gasto", "mixta", "con_gasto", "con_mercaderia"].includes(v("tipo")) ? v("tipo") : "",
    estado: ["vigente", "borrador", "anulado"].includes(estado) ? estado : "",
    desde: tieneFechas ? v("desde") : primeroDelMes(),
    hasta: tieneFechas ? v("hasta") : finDelMes(),
    sucursal: UUID.test(v("sucursal")) ? v("sucursal") : "",
    proveedor: UUID.test(v("proveedor")) ? v("proveedor") : "",
    categoria: UUID.test(v("categoria")) ? v("categoria") : "",
    tipo_costo: ["fijo", "variable"].includes(v("tipo_costo")) ? v("tipo_costo") : "",
    deducible: ["0", "1"].includes(v("deducible")) ? v("deducible") : "",
    origen: ["recurrente", "personal", "sin_comprobante", "orden_compra"].includes(v("origen")) ? v("origen") : "",
    tipo_pago: ["contado", "credito"].includes(v("tipo_pago")) ? v("tipo_pago") : "",
  };
}

function ComprasYGastos() {
  const router = useRouter();
  const sp = useSearchParams();
  const [f, setF] = useState<Filtros>(() => filtrosDeUrl(new URLSearchParams(sp.toString())));
  const [borrador, setBorrador] = useState("");
  const [q, setQ] = useState("");
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<Lista | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [cat, setCat] = useState<Catalogos | null>(null);
  const [catalogos, setCatalogos] = useState(false);
  // Detalles: compra (unificada) o gasto anterior; FormGasto solo para los borradores de recurrentes.
  const [compra, setCompra] = useState<string | null>(null);
  const [gasto, setGasto] = useState<string | null>(null);
  const [form, setForm] = useState<string | null>(null);
  const [accion, setAccion] = useState<{ modo: "anular" | "eliminar"; gasto: { id: string; numero: string | null } } | null>(null);
  // Nombre del proveedor del chip (llega por URL desde el Resumen; si no, de las filas).
  const [nombreProv] = useState(() => sp.get("nombre"));

  useEffect(() => {
    apiFetchCache<Catalogos>(URL_CATALOGOS).then(setCat).catch(() => setCat(null));
  }, [recarga]);
  useEffect(() => {
    const ver = sp.get("ver");
    const g = sp.get("gasto");
    if (ver && UUID.test(ver)) setCompra(ver);
    if (g && UUID.test(g)) setGasto(g);
  }, [sp]);
  useEffect(() => {
    const t = setTimeout(() => setQ(borrador.trim()), 300);
    return () => clearTimeout(t);
  }, [borrador]);
  useEffect(() => { setPagina(1); }, [q, f]);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    const p = new URLSearchParams({ pagina: String(pagina), por_pagina: String(POR_PAGINA) });
    if (q) p.set("q", q);
    for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
    apiFetch<Lista>(`/api/compras-gastos?${p}`)
      .then((r) => { if (vivo) { setDatos(r); setError(null); } })
      .catch((e) => { if (vivo) setError((e as Error).message); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [q, f, pagina, recarga]);

  const refrescar = useCallback(() => setRecarga((k) => k + 1), []);
  const setFiltro = (k: keyof Filtros, v: string) => setF((x) => ({ ...x, [k]: v }));
  // Al cerrar un detalle abierto por URL (?ver / ?gasto) se limpia la URL (quedan los filtros).
  const limpiarUrl = (claves: string[]) => {
    const p = new URLSearchParams(sp.toString());
    let cambio = false;
    for (const k of claves) if (p.has(k)) { p.delete(k); cambio = true; }
    if (cambio) router.replace(p.toString() ? `${RUTA}?${p}` : RUTA, { scroll: false });
  };
  const cerrarCompra = () => { setCompra(null); limpiarUrl(["ver"]); };
  const cerrarGasto = () => { setGasto(null); limpiarUrl(["gasto"]); };

  const columnas = useMemo(() => columnasLista({
    onEditar: (g) => setForm(g.id),
    onEliminar: (g) => setAccion({ modo: "eliminar", gasto: { id: g.id, numero: g.numero } }),
  }), []);

  // Chips de filtros que llegan por URL (Resumen, rutas viejas): se quitan con la ✕.
  const nombreCategoria = useMemo(() => {
    if (!f.categoria || !cat) return null;
    for (const r of cat.rubros) {
      if (r.id === f.categoria) return `${r.nombre} (todo el rubro)`;
      const s = r.subcategorias.find((x) => x.id === f.categoria);
      if (s) return `${r.nombre} › ${s.nombre}`;
    }
    return "Categoría";
  }, [f.categoria, cat]);
  const filas = datos?.rows ?? [];
  type Chip = { k: keyof Filtros; l: string };
  const chips = ([
    f.proveedor ? { k: "proveedor" as const, l: `Proveedor: ${nombreProv || filas.find((r) => r.proveedor_id === f.proveedor)?.proveedor_nombre || "elegido"}` } : null,
    f.categoria ? { k: "categoria" as const, l: `Categoría: ${nombreCategoria ?? "…"}` } : null,
    f.tipo === "con_gasto" ? { k: "tipo" as const, l: "Con gastos (incluye mixtas)" } : null,
    f.tipo === "con_mercaderia" ? { k: "tipo" as const, l: "Con mercadería (incluye mixtas)" } : null,
    f.tipo_costo ? { k: "tipo_costo" as const, l: f.tipo_costo === "fijo" ? "Solo gastos fijos" : "Solo gastos variables" } : null,
    f.deducible ? { k: "deducible" as const, l: f.deducible === "1" ? "IVA deducible" : "No deducible" } : null,
    f.origen ? { k: "origen" as const, l: ({ recurrente: "De recurrentes", personal: "De personal", sin_comprobante: "Sin comprobante", orden_compra: "De órdenes de compra" } as Record<string, string>)[f.origen] } : null,
  ] as (Chip | null)[]).filter((x): x is Chip => !!x);
  const quitarChip = (k: keyof Filtros) => {
    setFiltro(k, "");
    limpiarUrl(k === "proveedor" ? ["proveedor", "nombre"] : [k]);
  };
  const filtrosActivos = [f.sucursal, f.estado, f.tipo_pago].filter(Boolean).length + chips.length;
  const limpiarFiltros = () => {
    setF((x) => ({ ...x, sucursal: "", estado: "", tipo_pago: "", proveedor: "", categoria: "", tipo_costo: "", deducible: "", origen: "", tipo: ["con_gasto", "con_mercaderia"].includes(x.tipo) ? "" : x.tipo }));
    limpiarUrl(["proveedor", "nombre", "categoria", "tipo_costo", "deducible", "origen", "estado", "sucursal", "tipo_pago"]);
  };

  const total = datos?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const tipoSegmento = ["con_gasto", "con_mercaderia"].includes(f.tipo) ? "" : f.tipo;

  return (
    <div className="space-y-5 pb-10">
      <EncabezadoPagina
        titulo="Compras y gastos"
        subtitulo="Facturas de mercadería, gastos de la empresa y compras mixtas en una sola lista. La mercadería suma stock; los gastos van al resumen por categoría."
        acciones={<AccionesPagina acciones={[
          { etiqueta: "Catálogos", icono: <FolderCog />, onClick: () => setCatalogos(true) },
          // Un solo botón: el tipo (mercadería / gasto / mixta) se elige adentro (receta 59).
          { etiqueta: "Nueva compra o gasto", icono: <Plus />, href: "/compras/nueva", primaria: true },
        ]} />} />

      {/* Tipo: un toque (en celular, 4 botones de 44 px en una fila) */}
      <div className="grid grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1 sm:inline-grid sm:w-auto" role="radiogroup" aria-label="Tipo de documento">
        {TIPOS.map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={tipoSegmento === v} onClick={() => setFiltro("tipo", v)}
            className={`min-h-11 rounded-lg px-2 text-[13px] font-semibold transition sm:min-h-9 sm:px-4 sm:text-sm ${tipoSegmento === v ? "bg-white text-[var(--brand)] shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
            {l}
          </button>
        ))}
      </div>

      {datos && datos.borradores > 0 && f.estado !== "borrador" ? (
        <button onClick={() => setF((x) => ({ ...x, estado: "borrador", desde: "", hasta: "", tipo: "" }))}
          className="flex w-full items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-left text-sm text-amber-800 hover:bg-amber-100/60 max-sm:min-h-11">
          <CalendarClock className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">Tenés <b>{datos.borradores}</b> {datos.borradores === 1 ? "gasto en borrador" : "gastos en borrador"} (de recurrentes) para completar y confirmar.</span>
          <span className="shrink-0 text-xs font-semibold underline-offset-2 hover:underline">Ver</span>
        </button>
      ) : null}

      <BarraFiltros
        activos={filtrosActivos}
        onLimpiar={limpiarFiltros}
        busqueda={
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input type="search" enterKeyHint="search" value={borrador} onChange={(e) => setBorrador(e.target.value)}
              placeholder="Número, factura, monto, RUC, proveedor, producto o gasto…" aria-label="Buscar compras y gastos" className={`${INPUT} w-full pl-9 max-sm:min-h-11`} />
          </div>
        }>
        <div className="flex flex-wrap items-center gap-2 max-md:grid max-md:grid-cols-2">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 max-md:flex-col max-md:items-stretch max-md:gap-1">Desde
            <SelectorFecha compacto etiqueta="Desde" value={f.desde} onChange={(v) => setFiltro("desde", v)} claseBoton="rounded-xl px-3 py-2 text-slate-800" className="min-w-0 max-md:w-full md:w-[150px]" />
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500 max-md:flex-col max-md:items-stretch max-md:gap-1">Hasta
            <SelectorFecha compacto etiqueta="Hasta" value={f.hasta} onChange={(v) => setFiltro("hasta", v)} claseBoton="rounded-xl px-3 py-2 text-slate-800" className="min-w-0 max-md:w-full md:w-[150px]" />
          </div>
          {f.desde || f.hasta ? (
            <button onClick={() => setF((x) => ({ ...x, desde: "", hasta: "" }))} className="text-xs font-semibold text-[var(--brand)] underline-offset-2 hover:underline max-md:col-span-2 max-md:min-h-11 max-md:rounded-lg max-md:border max-md:border-slate-200 max-md:no-underline">Todas las fechas</button>
          ) : (
            <button onClick={() => setF((x) => ({ ...x, desde: primeroDelMes(), hasta: finDelMes() }))} className="text-xs font-semibold text-[var(--brand)] underline-offset-2 hover:underline max-md:col-span-2 max-md:min-h-11 max-md:rounded-lg max-md:border max-md:border-slate-200 max-md:no-underline">Este mes</button>
          )}
        </div>
        {(cat?.sucursales.length ?? 0) > 1 ? (
          <Select value={f.sucursal} onChange={(v) => setFiltro("sucursal", v)} minWidth={170} etiqueta="Sucursal"
            options={[["", "Todas las sucursales"], ...(cat?.sucursales ?? []).map((s): [string, string] => [s.id, s.nombre])]} />
        ) : null}
        <Select value={f.estado} onChange={(v) => setFiltro("estado", v)} minWidth={150} etiqueta="Estado"
          options={[["", "Todos los estados"], ["vigente", "Vigentes"], ["borrador", "Borradores"], ["anulado", "Anulados"]]} />
        <Select value={f.tipo_pago} onChange={(v) => setFiltro("tipo_pago", v)} minWidth={150} etiqueta="Condición"
          options={[["", "Contado y crédito"], ["contado", "Contado"], ["credito", "Crédito"]]} />
        {chips.map((c) => (
          <span key={c.k + c.l} className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 pl-3 pr-1 text-sm text-slate-700 sm:min-h-10">
            <span className="truncate">{c.l}</span>
            <button type="button" aria-label={`Quitar filtro: ${c.l}`} onClick={() => quitarChip(c.k)}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-white hover:text-slate-800 sm:h-8 sm:w-8">
              <X className="h-4 w-4" />
            </button>
          </span>
        ))}
      </BarraFiltros>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <TablaTarjetas
          filas={cargando && !datos ? [] : filas}
          claveFila={(r) => `${r.origen}-${r.id}`}
          onFila={(r) => (r.origen === "compra" ? setCompra(r.id) : r.estado === "borrador" ? setForm(r.id) : setGasto(r.id))}
          cargando={cargando && !!datos}
          minAncho={980}
          claseThead="border-b border-slate-200 bg-slate-50"
          thBase="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
          tdBase="px-3 py-2"
          claseFila={(r) => `border-b border-slate-100 last:border-0 ${r.estado === "anulado" ? "opacity-60" : ""}`}
          vacio={<p className="px-3 py-10 text-center text-sm text-slate-400">{cargando && !datos ? "Cargando…" : "No hay compras ni gastos que coincidan."}</p>}
          columnas={columnas}
        />
        {filas.length > 0 ? (
          <div className="flex items-start justify-between gap-3 border-t-2 border-slate-100 bg-slate-50/80 px-3.5 py-3 sm:px-4">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-700">Total vigente de la vista</p>
              <p className="text-[11px] text-slate-500 sm:text-[10px]">
                {total} {total === 1 ? "documento" : "documentos"} · mercadería {gs(datos?.total_mercaderia)} · gastos {gs(datos?.total_gastos)} · IVA crédito fiscal {gs(datos?.total_iva)}
                {Number(datos?.total_borradores) > 0 ? ` · en borrador ${gs(datos?.total_borradores)}` : ""}
              </p>
            </div>
            <p className="shrink-0 whitespace-nowrap text-right text-base font-bold tabular-nums text-slate-900 sm:text-sm">{gs(datos?.total_monto)}</p>
          </div>
        ) : null}
        {total > POR_PAGINA ? (
          <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3.5 py-3 text-xs text-slate-500 sm:px-5">
            <span>Página {pagina} de {totalPaginas}</span>
            <div className="flex gap-2">
              <button disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40 max-sm:min-h-11 max-sm:px-4">Anterior</button>
              <button disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40 max-sm:min-h-11 max-sm:px-4">Siguiente</button>
            </div>
          </div>
        ) : null}
      </div>

      {compra ? <DetalleCompra id={compra} onClose={cerrarCompra} onAnulada={refrescar} /> : null}
      {form ? <FormGasto gastoId={form} onClose={() => setForm(null)} onHecho={refrescar} /> : null}
      {gasto ? (
        <DetalleGasto id={gasto} onClose={cerrarGasto} onCambio={refrescar}
          onEditar={(id) => { cerrarGasto(); setForm(id); }}
          onEliminar={(g) => setAccion({ modo: "eliminar", gasto: g })}
          onAnular={(g) => setAccion({ modo: "anular", gasto: g })} />
      ) : null}
      {accion ? (
        <ConfirmarAccionGasto modo={accion.modo} gasto={accion.gasto} onClose={() => setAccion(null)}
          onHecho={() => { if (accion.modo === "eliminar") cerrarGasto(); refrescar(); }} />
      ) : null}
      {catalogos ? <CatalogosGastos onClose={() => setCatalogos(false)} onCambio={refrescar} /> : null}
    </div>
  );
}

const condicionDe = (r: Fila) => r.tipo_pago === "credito"
  ? r.cxp ? (r.cxp.estado === "anulada" ? "Crédito" : Number(r.cxp.saldo) > 0 ? `Crédito · debés ${monto(r.cxp.saldo, r.cxp.moneda)}` : "Crédito · pagado")
    : `Crédito${r.vencimiento ? ` · vence ${fechaCorta(r.vencimiento)}` : ""}`
  : r.tipo_pago === "contado" ? `Contado${r.medio_pago ? ` · ${nombreMedioGasto(r.medio_pago)}` : ""}` : null;

const numeroConIconos = (r: Fila) => (
  <>
    <span className="whitespace-nowrap font-mono font-semibold">{r.numero ?? "—"}</span>
    {r.adjuntos > 0 ? <Paperclip className="ml-1 inline h-3 w-3 text-slate-400" aria-label={`${r.adjuntos} adjuntos`} /> : null}
    {r.recurrente_id ? <CalendarClock className="ml-1 inline h-3 w-3 text-[var(--brand-400)]" aria-label="De una plantilla recurrente" /> : null}
  </>
);

/** Qué se compró: productos y/o categorías de gasto. */
const detalleDe = (r: Fila) => [
  r.productos > 0 ? `${r.productos} ${r.productos === 1 ? "producto" : "productos"}` : null,
  r.categorias,
].filter(Boolean).join(" · ");

function ChipTipo({ r }: { r: Fila }) {
  const t = TIPO_COMPRA[r.tipo] ?? TIPO_COMPRA.gasto;
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${t.c}`}>{r.tipo === "gasto" ? <Receipt className="h-3 w-3" /> : <Package className="h-3 w-3" />}{t.t}</span>;
}

/**
 * Columnas: tabla en ≥ 768 px y, en celular, tarjeta con proveedor/concepto (título), número
 * + qué se compró (subtítulo), total (valor), tipo y estado (chips), comprobante / condición /
 * fecha (datos) y, en los borradores, "Abrir y confirmar" al pie. Tocar abre el detalle.
 */
function columnasLista(h: { onEditar: (r: Fila) => void; onEliminar: (r: Fila) => void }): ColumnaTabla<Fila>[] {
  return [
    {
      key: "numero", titulo: "Número", claseTh: "pl-4", claseTd: "whitespace-nowrap pl-4 text-xs text-slate-700",
      celda: (r) => (
        <>
          {numeroConIconos(r)}
          {r.oc_numero ? <span className="block font-mono text-[10px] text-sky-700" title="Recepción de una orden de compra">{r.oc_numero}</span> : null}
        </>
      ),
      movil: "subtitulo",
      celdaMovil: (r) => <>{numeroConIconos(r)}{detalleDe(r) ? <span className="text-slate-400"> · {detalleDe(r)}</span> : null}</>,
    },
    {
      key: "proveedor", titulo: "Proveedor / concepto", movil: "titulo",
      celda: (r) => (
        <>
          <p className="text-slate-800">{r.proveedor_nombre ?? <span className="text-slate-500">{r.descripcion ?? "Sin proveedor"}</span>}</p>
          {detalleDe(r) ? <p className="max-w-[16rem] truncate text-[11px] text-slate-400 xl:max-w-[22rem]">{detalleDe(r)}</p> : null}
        </>
      ),
      celdaMovil: (r) => r.proveedor_nombre ?? r.descripcion ?? "Sin proveedor",
    },
    {
      key: "tipo", titulo: "Tipo", movil: "chip",
      celda: (r) => <ChipTipo r={r} />,
      // Un solo chip en el celular: el estado si no está vigente; si no, el tipo.
      celdaMovil: (r) => (r.estado !== "vigente"
        ? <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO[r.estado].c}`}>{ESTADO[r.estado].t}</span>
        : <ChipTipo r={r} />),
    },
    {
      key: "comprobante", titulo: "Comprobante", claseTd: "text-xs text-slate-500", movil: "dato",
      celda: (r) => {
        const condicion = condicionDe(r);
        return (
          <>
            {r.con_comprobante
              ? (r.comprobante ? <><span className="text-slate-400">{r.tipo_comprobante ?? "Factura"} </span><span className="whitespace-nowrap font-mono">{r.comprobante}</span></> : r.tipo_comprobante ?? "—")
              : <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Sin comprobante</span>}
            {condicion ? <span className="block text-[11px] text-slate-400">{condicion}</span> : null}
          </>
        );
      },
      celdaMovil: (r) => (r.con_comprobante ? r.comprobante ?? r.tipo_comprobante ?? null : <span className="text-amber-700">Sin comprobante</span>),
    },
    // En tablet (768–1023) la sucursal se omite para que la tabla entre mejor (se ve en el detalle).
    { key: "sucursal", titulo: "Sucursal", claseTh: "max-lg:hidden", claseTd: "text-xs text-slate-500 max-lg:hidden", movil: "oculto", celda: (r) => r.sucursal_nombre ?? "—" },
    {
      key: "fecha", titulo: "Fecha", claseTd: "whitespace-nowrap text-xs text-slate-500", movil: "dato",
      celda: (r) => (
        <>
          {fechaCorta(r.fecha)}
          {r.estado === "borrador" && r.fecha_programada ? <span className="block text-[11px] text-amber-600">programado</span> : null}
        </>
      ),
    },
    {
      key: "total", titulo: "Total", claseTh: "text-right", claseTd: "whitespace-nowrap text-right tabular-nums", movil: "valor",
      celda: (r) => (
        <>
          <span className={`font-semibold ${r.estado === "anulado" ? "text-slate-400 line-through" : "text-slate-800"}`}>{monto(r.total, r.moneda)}</span>
          {r.moneda === "USD" ? <span className="block text-[11px] font-normal text-slate-400">{gs(r.total_gs)}</span> : null}
          {r.tipo === "mixta" ? <span className="block text-[10px] font-normal text-slate-400">merc. {gs(r.total_mercaderia)} · gasto {gs(r.total_gastos)}</span> : null}
        </>
      ),
      celdaMovil: (r) => <span className={r.estado === "anulado" ? "text-slate-400 line-through" : ""}>{monto(r.total, r.moneda)}</span>,
    },
    {
      key: "estado", titulo: "Estado", claseTh: "text-center", claseTd: "text-center", movil: "oculto",
      celda: (r) => (
        <>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO[r.estado].c}`}>{ESTADO[r.estado].t}</span>
          {r.estado === "anulado" && r.anulado_motivo ? <span className="mt-0.5 block max-w-[8rem] truncate text-[10px] text-rose-500" title={r.anulado_motivo}>{r.anulado_motivo}</span> : null}
        </>
      ),
    },
    {
      key: "acciones", titulo: "", claseTh: "pr-4", claseTd: "pr-4", movil: "pie",
      celda: (r) => r.origen === "gasto" && r.estado === "borrador" ? (
        // No abre la fila: las acciones tienen su propio click.
        <div className="flex items-center justify-end gap-1.5 text-xs max-md:text-[13px]" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => h.onEditar(r)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2 py-1 font-semibold text-white hover:bg-emerald-700 max-md:min-h-11 max-md:px-3"><Pencil className="h-3 w-3" /> Abrir y confirmar</button>
          <button onClick={() => h.onEliminar(r)} aria-label="Eliminar borrador" className="inline-flex items-center justify-center gap-1 rounded-lg px-2 py-1 text-rose-600 hover:bg-rose-50 max-md:h-11 max-md:w-11 max-md:!flex-none"><Trash2 className="h-3 w-3 max-md:h-4 max-md:w-4" /></button>
        </div>
      ) : null,
    },
  ];
}
