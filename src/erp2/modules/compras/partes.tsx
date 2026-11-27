"use client";

/** Piezas compartidas por Nueva compra y Nueva orden de compra. */
import { useEffect, useRef, useState } from "react";
import { Loader2, Package, Plus, Search } from "lucide-react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { clienteConfig } from "@/erp2/cliente.config";
import type { ProductoInventario } from "@/erp2/modules/inventario/tipos";

const TEAL = clienteConfig.color;
export const INPUT = "w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";
export const ET = "mb-1 block text-xs font-medium text-slate-600";
export const gs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
export const usd = (v: number) => `US$ ${Number(v || 0).toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Monto en la moneda del documento (US$ si es USD, si no Gs.). */
export const montoMoneda = (v: number, moneda?: string | null) => (moneda === "USD" ? usd(v) : gs(v));
/** Equivalente en guaraníes para montos en USD (null en Gs). */
export const equivGs = (v: number, moneda?: string | null, tipoCambio?: number | null) =>
  moneda === "USD" && Number(tipoCambio) > 0 ? `≈ ${gs((Number(v) || 0) * Number(tipoCambio))}` : null;
export const ivaDe = (importe: number, tipo: string) => (tipo === "10%" ? Math.round(importe / 11) : tipo === "5%" ? Math.round(importe / 21) : 0);

export function sumarDias(fecha: string, dias: number) {
  const d = new Date(`${fecha}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Foto chica del producto (o un ícono si no tiene). */
export function MiniaturaProducto({ url, nombre, clase = "h-10 w-10" }: { url?: string | null; nombre: string; clase?: string }) {
  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-300 ${clase}`}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={nombre} loading="lazy" decoding="async" className="h-full w-full object-cover" />
      ) : <Package className="h-5 w-5" />}
    </span>
  );
}

/**
 * Buscador de productos con búsqueda inteligente (sin tildes, en cualquier orden, con errores de
 * tipeo y por cómo suena); Enter agrega el primero (lector de códigos). Con `deposito`, el stock que
 * muestra es el de ese depósito.
 */
export function BuscadorProductos({ onElegir, onCrear, mostrarPrecio = false, tipo, deposito, conStockPrimero = false, agregados }: {
  /** El depósito con el que se trabaja: `id` y `nombre`. */
  deposito?: { id: string; nombre: string } | null;
  /** Los que tienen stock en `deposito` van primero (traslados: lo que se puede mover). */
  conStockPrimero?: boolean;
  /** Ids ya elegidos en el documento: se marcan como "Ya agregado". */
  agregados?: string[];
  onElegir: (p: ProductoInventario) => void;
  /** Si viene, ofrece "+ Crear producto" con lo que se buscó (alta rápida en un modal). */
  onCrear?: (texto: string) => void;
  /** Muestra el precio de venta en vez del costo (ej. Presupuestos). */
  mostrarPrecio?: boolean;
  /**
   * Receta 72: qué tipos busca. Por defecto, con precio (Presupuestos) "vendible" (sin materias
   * primas) y si no "stock" (compras, traslados, ajustes: sin productos Menú, que no llevan stock).
   */
  tipo?: "reventa" | "menu" | "materia_prima" | "stock" | "vendible";
}) {
  const filtroTipo = tipo ?? (mostrarPrecio ? "vendible" : "stock");
  const [q, setQ] = useState("");
  const [res, setRes] = useState<ProductoInventario[]>([]);
  const [hi, setHi] = useState(0);
  const [buscando, setBuscando] = useState(false);
  const [resDe, setResDe] = useState(""); // texto al que corresponden los resultados
  const [abierto, setAbierto] = useState(true);
  const ref = useRef<HTMLInputElement>(null);

  const stockEn = (p: ProductoInventario) => (deposito
    ? Number(p.stock_depositos?.find((s) => s.d === deposito.id)?.c ?? 0)
    : Number(p.stock_actual));
  // Orden estable: dentro de cada grupo se respeta la relevancia que dio la búsqueda.
  const ordenar = (filas: ProductoInventario[]) => (conStockPrimero && deposito
    ? [...filas.filter((p) => stockEn(p) > 0), ...filas.filter((p) => stockEn(p) <= 0)]
    : filas);

  // Cache en memoria por texto: backspace/retipeo no vuelve a pegarle a la API.
  const cacheRef = useRef(new Map<string, ProductoInventario[]>());
  const consultar = async (t: string) => {
    const key = `${filtroTipo}|${t}`;
    const hit = cacheRef.current.get(key);
    if (hit) return ordenar(hit);
    const r = await apiFetch<{ rows: ProductoInventario[] }>(`/api/productos?paginado=1&por_pagina=8&tipo=${filtroTipo}&q=${encodeURIComponent(t)}`);
    cacheRef.current.set(key, r.rows);
    return ordenar(r.rows);
  };

  // El lector de códigos tipea y manda Enter enseguida: si los resultados todavía no
  // son de lo escrito, se busca en el momento y se agrega el primero.
  async function enter() {
    const t = q.trim();
    if (!t) return;
    if (resDe === t && res[hi]) { elegir(res[hi]); return; }
    try {
      const filas = await consultar(t);
      if (filas[0]) elegir(filas[0]);
    } catch { /* sin resultados */ }
  }

  useEffect(() => {
    const t = q.trim();
    if (!t) { setRes([]); setResDe(""); return; }
    // Si ya lo buscamos, mostrarlo al instante (sin debounce ni spinner).
    const hit = cacheRef.current.get(`${filtroTipo}|${t}`);
    if (hit) { setRes(ordenar(hit)); setResDe(t); setHi(0); setBuscando(false); return; }
    let vivo = true;
    const h = setTimeout(() => {
      setBuscando(true);
      consultar(t)
        .then((rows) => { if (vivo) { setRes(rows); setResDe(t); setHi(0); } })
        .catch(() => vivo && setRes([]))
        .finally(() => vivo && setBuscando(false));
    }, 200);
    return () => { vivo = false; clearTimeout(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function elegir(p: ProductoInventario) {
    onElegir(p);
    setQ("");
    setRes([]);
    setResDe("");
    ref.current?.focus();
  }

  function crear() {
    const t = q.trim();
    setQ("");
    setRes([]);
    setResDe("");
    onCrear?.(t);
  }

  return (
    <div className="flex items-start gap-2">
    <div className="relative min-w-0 flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input ref={ref} value={q} onChange={(e) => { setQ(e.target.value); setAbierto(true); }} onFocus={() => setAbierto(true)} onBlur={() => setAbierto(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, res.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); void enter(); }
          else if (e.key === "Escape") setQ("");
        }}
        placeholder="Buscá o escaneá un producto (nombre, SKU o código)…" autoComplete="off" enterKeyHint="search" aria-label="Buscar producto" className={`${INPUT} pl-9`} />
      {buscando ? <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" /> : null}
      {abierto && res.length ? (
        // Sin perder el foco del buscador al tocar un resultado (si no, se cerraría antes del click).
        <ul onMouseDown={(e) => e.preventDefault()} className="absolute z-20 mt-1 max-h-96 w-full overflow-auto overscroll-contain rounded-xl border border-slate-200 bg-white py-1 shadow-lg max-sm:max-h-[min(20rem,50dvh)]">
          {res.map((p, i) => {
            const stock = stockEn(p);
            const yaEsta = !!agregados?.includes(p.id);
            return (
              <li key={p.id}>
                <button type="button" onMouseEnter={() => setHi(i)} onClick={() => elegir(p)}
                  className={`flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left text-sm ${hi === i ? "bg-[var(--brand-50)]" : ""}`}>
                  <MiniaturaProducto url={p.imagen_url} nombre={p.nombre} />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium text-slate-800">{p.nombre}</span>
                      {yaEsta ? <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">Ya agregado</span> : null}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-slate-400">{p.sku}{p.codigo_barras ? ` · ${p.codigo_barras}` : ""}</span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-slate-500">
                    {deposito && stock <= 0
                      ? <span className="font-medium text-rose-600">Sin stock en {deposito.nombre}</span>
                      : <>{deposito ? `en ${deposito.nombre}: ` : "stock "}<b className="font-semibold text-slate-700">{stock.toLocaleString("es-PY")}</b></>}
                    {mostrarPrecio ? <><br />precio {gs(Number(p.precio_venta))}</> : p.costo_promedio != null ? <><br />costo {gs(Number(p.costo_promedio))}</> : null}
                  </span>
                </button>
              </li>
            );
          })}
          {onCrear ? (
            <li className="border-t border-slate-100">
              <button type="button" onClick={crear} className="flex min-h-11 w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold text-[var(--brand)] hover:bg-[var(--brand-50)]">
                <Plus className="h-4 w-4" /> Crear producto «{q.trim()}»
              </button>
            </li>
          ) : null}
        </ul>
      ) : abierto && q.trim() && !buscando && resDe === q.trim() && !res.length ? (
        <div onMouseDown={(e) => e.preventDefault()} className="absolute z-20 mt-1 w-full rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
          <p className="text-xs text-slate-500">Ningún producto coincide con «{q.trim()}».</p>
          {onCrear ? (
            <button type="button" onClick={crear}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white hover:brightness-95" style={{ backgroundColor: TEAL }}>
              <Plus className="h-3.5 w-3.5" /> Crear «{q.trim()}» como producto nuevo
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
    {onCrear ? (
      <button type="button" onClick={crear} title="Crear un producto nuevo y agregarlo" aria-label="Nuevo producto"
        className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)] max-sm:w-11 max-sm:px-0 sm:min-h-0">
        <Plus className="h-4 w-4" /> <span className="max-sm:hidden">Nuevo producto</span>
      </button>
    ) : null}
    </div>
  );
}

export function Tarjeta({ numero, titulo, extra, children }: { numero: number; titulo: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="flex items-center gap-2.5 text-sm font-semibold text-slate-800">
          <span className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white" style={{ backgroundColor: TEAL }}>{numero}</span>
          {titulo}
        </h2>
        {extra}
      </div>
      {children}
    </section>
  );
}

export function Fila({ l, v }: { l: string; v: string }) {
  return <div className="flex justify-between text-slate-600"><dt>{l}</dt><dd className="tabular-nums">{v}</dd></div>;
}

export function Segmentado({ valor, onChange, opciones }: { valor: string; onChange: (v: string) => void; opciones: [string, string][] }) {
  return (
    <div className="flex rounded-xl bg-slate-100 p-1">
      {opciones.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onChange(v)}
          className={`min-h-9 flex-1 rounded-lg px-2 py-1.5 text-sm font-semibold transition max-sm:min-h-10 ${valor === v ? "bg-white shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          style={valor === v ? { color: TEAL } : undefined}>
          {l}
        </button>
      ))}
    </div>
  );
}
