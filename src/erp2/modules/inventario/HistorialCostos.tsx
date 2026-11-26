"use client";

/**
 * Proveedores y costos (ficha del producto): el historial de compras AGRUPADO por proveedor.
 * Por cada proveedor muestra último costo, costo mínimo, costo promedio (ponderado por cantidad),
 * cuántas compras y la última fecha; "Ver historial" despliega las compras de ese proveedor
 * (cuánto se pagó cada vez, con factura y la variación contra la compra anterior).
 * Todo sale de historial_costos_producto (no toca la base): cada compra ya trae proveedor y costo.
 */
import { useMemo, useState } from "react";
import { Loader2, TrendingDown, TrendingUp, ChevronDown } from "lucide-react";
import { useListaCacheada } from "@/erp2/modules/inventario/lista-cache";
import { urlCostos } from "@/erp2/modules/inventario/ficha-cache";
import { TZ_PY } from "@/erp2/lib/fecha/paraguay";

export type CompraCosto = {
  id: string;
  fecha: string;
  cantidad: number;
  costo: number;
  proveedor: string | null;
  proveedor_id: string | null;
  factura: string | null;
  origen: string;
  referencia: string | null;
  usuario: string | null;
  variacion_pct: number | null;
};
export type HistorialCostosData = { costo_promedio: number | null; total_compras: number; compras: CompraCosto[] };

const gs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
const num = (v: number) => Number(v || 0).toLocaleString("es-PY", { maximumFractionDigits: 3 });
const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "short", year: "numeric" });

type GrupoProveedor = {
  key: string;
  label: string;
  items: CompraCosto[];
  ultimo: number;
  minimo: number;
  promedio: number;
  ultimaFecha: string;
};

/** Agrupa las compras por proveedor (o "Inventario inicial" / "Sin proveedor") con sus estadísticas. */
function agruparPorProveedor(compras: CompraCosto[]): GrupoProveedor[] {
  const mapa = new Map<string, { label: string; items: CompraCosto[] }>();
  for (const c of compras) {
    const inicial = c.origen === "inventario_inicial";
    const nombre = c.proveedor?.trim();
    const key = c.proveedor_id ?? nombre ?? (inicial ? "__inicial__" : "__sin__");
    const label = nombre || (inicial ? "Inventario inicial" : "Sin proveedor");
    if (!mapa.has(key)) mapa.set(key, { label, items: [] });
    mapa.get(key)!.items.push(c);
  }
  const grupos: GrupoProveedor[] = [];
  for (const [key, g] of mapa) {
    // Las compras ya vienen ordenadas de más nueva a más vieja desde la API.
    let totalCosto = 0;
    let totalCant = 0;
    let minimo = Infinity;
    for (const x of g.items) {
      const costo = Number(x.costo) || 0;
      const cant = Number(x.cantidad) || 0;
      totalCosto += costo * cant;
      totalCant += cant;
      if (costo < minimo) minimo = costo;
    }
    const promedio = totalCant > 0 ? totalCosto / totalCant : g.items.reduce((a, x) => a + (Number(x.costo) || 0), 0) / g.items.length;
    grupos.push({
      key,
      label: g.label,
      items: g.items,
      ultimo: Number(g.items[0].costo) || 0,
      minimo: minimo === Infinity ? 0 : minimo,
      promedio,
      ultimaFecha: g.items[0].fecha,
    });
  }
  // Proveedor con la compra más reciente primero.
  return grupos.sort((a, b) => +new Date(b.ultimaFecha) - +new Date(a.ultimaFecha));
}

export function HistorialCostos({ productoId, unidad }: { productoId: string; unidad: string }) {
  // Cacheado (y precargado al pasar el mouse por "editar"): reabrir la ficha pinta al instante.
  const { datos, cargando, error } = useListaCacheada<HistorialCostosData>(urlCostos(productoId));
  const data = cargando ? null : datos;
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const grupos = useMemo(() => (data ? agruparPorProveedor(data.compras) : []), [data]);

  if (error) return <p className="text-xs text-rose-600">No se pudo cargar el historial de costos.</p>;
  if (!data) {
    return <p className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando historial…</p>;
  }
  if (!data.compras.length) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 px-4 py-3 text-xs text-slate-500">
        Todavía no hay compras registradas. Cargalas en <strong className="font-semibold text-slate-700">Inventario › Movimientos › Nuevo movimiento</strong> como
        entrada por compra, con el costo, el proveedor y la factura.
      </p>
    );
  }

  const toggle = (key: string) =>
    setAbiertos((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-slate-400">Costos por proveedor, derivados de las compras reales registradas.</p>
      {grupos.map((g) => {
        const abierto = abiertos.has(g.key);
        return (
          <div key={g.key} className="overflow-hidden rounded-xl border border-slate-200">
            <div className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{g.label}</p>
                <p className="text-[11px] text-slate-500">
                  {g.items.length === 1 ? "1 compra" : `${g.items.length} compras`} · última {fecha(g.ultimaFecha)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => toggle(g.key)}
                aria-expanded={abierto}
                className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[var(--brand)] hover:underline"
              >
                Ver historial
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${abierto ? "rotate-180" : ""}`} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-px border-t border-slate-100 bg-slate-100 sm:grid-cols-4">
              <Dato etiqueta="Último costo" valor={gs(g.ultimo)} brand />
              <Dato etiqueta="Costo mínimo" valor={gs(g.minimo)} />
              <Dato etiqueta="Costo promedio" valor={gs(g.promedio)} />
              <Dato etiqueta="Compras" valor={String(g.items.length)} />
            </div>

            {abierto ? (
              <ul className="divide-y divide-slate-100 border-t border-slate-100">
                {g.items.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800">
                        {fecha(c.fecha)} <span className="font-normal text-slate-400">· {num(c.cantidad)} {unidad === "Unidad" ? "u." : unidad}</span>
                      </p>
                      {c.factura ? <p className="truncate text-[11px] text-slate-500">Fact. {c.factura}</p> : null}
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums text-slate-900">{gs(c.costo)}</p>
                      <Variacion pct={c.variacion_pct} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** Una celda de estadística dentro de la tarjeta del proveedor. */
function Dato({ etiqueta, valor, brand }: { etiqueta: string; valor: string; brand?: boolean }) {
  return (
    <div className="bg-white px-4 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{etiqueta}</p>
      <p className={`text-sm font-bold tabular-nums ${brand ? "text-[var(--brand-700)]" : "text-slate-900"}`}>{valor}</p>
    </div>
  );
}

/** ▲ subió (rojo: cuesta más) / ▼ bajó (verde) contra la compra anterior. */
export function Variacion({ pct }: { pct: number | null }) {
  if (pct == null) return <p className="text-[11px] text-slate-400">primera compra</p>;
  if (Number(pct) === 0) return <p className="text-[11px] text-slate-400">igual que la anterior</p>;
  const sube = Number(pct) > 0;
  const Icono = sube ? TrendingUp : TrendingDown;
  return (
    <p className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${sube ? "text-rose-600" : "text-emerald-600"}`}>
      <Icono className="h-3 w-3" /> {sube ? "+" : "−"}{Math.abs(Number(pct)).toLocaleString("es-PY")} %
    </p>
  );
}
