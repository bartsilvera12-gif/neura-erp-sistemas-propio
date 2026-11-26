"use client";

/**
 * /compras/ordenes/nueva — pedido al proveedor (orden de compra). Sin factura y sin
 * mover stock: proveedor (propone su condición y moneda), fecha de entrega esperada,
 * productos con cantidad y costo estimado (se propone el de la última compra).
 * Con ?editar=ID edita una orden que todavía no recibió nada.
 */
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, Download, Loader2, Package, Trash2 } from "lucide-react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { descargarArchivo } from "@/erp2/lib/api/client-blob";
import { clienteConfig } from "@/erp2/cliente.config";
import MontoInput from "@/erp2/components/ui/MontoInput";
import { SelectorProveedor } from "@/erp2/modules/proveedores/SelectorProveedor";
import type { HistorialCostosData } from "@/erp2/modules/inventario/HistorialCostos";
import { traerProductosLote } from "@/erp2/modules/inventario/lote";
import type { ProductoInventario } from "@/erp2/modules/inventario/tipos";
import type { ProveedorMin } from "@/erp2/modules/proveedores/tipos";
import { cargarProveedores } from "@/erp2/modules/proveedores/cache";
import type { OrdenCompra } from "@/erp2/modules/compras/ordenes";
import { ProductoForm } from "@/erp2/modules/inventario/ProductoForm";
import { BuscadorProductos, ET, Fila, gs, INPUT, Segmentado, Tarjeta, usd } from "@/erp2/modules/compras/partes";
import { SelectorFecha } from "@/erp2/components/SelectorFecha";

const TEAL = clienteConfig.color;

type Linea = { key: string; prod: ProductoInventario; cantidad: string; costo: number; ultima: number | null };

export default function NuevaOrdenPage({ modo }: { modo?: "solicitud" }) {
  return (
    <Suspense>
      <NuevaOrden modo={modo} />
    </Suspense>
  );
}

function NuevaOrden({ modo }: { modo?: "solicitud" }) {
  const sp = useSearchParams();
  const editarId = sp.get("editar");
  // Modo "solicitud": mismo formulario, pero crea una solicitud de compra
  // (queda 'solicitada', a confirmar) en vez de una orden ya aprobada.
  const esSolicitud = (modo === "solicitud" || sp.get("modo") === "solicitud") && !editarId;
  const [proveedores, setProveedores] = useState<ProveedorMin[]>([]);
  const [proveedorId, setProveedorId] = useState<string | null>(null);
  const [entrega, setEntrega] = useState("");
  const [tipoPago, setTipoPago] = useState<"contado" | "credito">("contado");
  const [plazo, setPlazo] = useState("30");
  const [moneda, setMoneda] = useState<"GS" | "USD">("GS");
  const [cambio, setCambio] = useState(0);
  const [observacion, setObservacion] = useState("");
  const [creandoProd, setCreandoProd] = useState<string | null>(null);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecha, setHecha] = useState<{ id: string; numero: string } | null>(null);
  const [numeroEditando, setNumeroEditando] = useState<string | null>(null);
  // Al crear: un doble clic o un reintento devuelve la misma orden (no dos).
  const [idem] = useState(() => crypto.randomUUID());

  useEffect(() => {
    // Misma lista (y misma llamada) que usa el SelectorProveedor.
    void cargarProveedores().then(setProveedores);
  }, []);

  // Editar: carga la orden.
  useEffect(() => {
    if (!editarId) return;
    let vivo = true;
    (async () => {
      try {
        const o = await apiFetch<OrdenCompra>(`/api/ordenes-compra/${editarId}`);
        // Todos los productos de la orden en un solo request (no uno por producto).
        const { productos } = await traerProductosLote<ProductoInventario>((o.items ?? []).map((i) => i.producto_id));
        const prods = (o.items ?? []).map((i) => productos.get(i.producto_id) ?? null);
        if (!vivo) return;
        setNumeroEditando(o.numero_oc);
        setProveedorId(o.proveedor_id);
        setEntrega(o.fecha_entrega ?? "");
        setTipoPago(o.tipo_pago);
        if (o.plazo_dias) setPlazo(String(o.plazo_dias));
        setMoneda(o.moneda);
        if (o.moneda === "USD") setCambio(Number(o.tipo_cambio) || 0);
        setObservacion(o.observacion ?? "");
        setLineas((o.items ?? []).flatMap((i, n) => (prods[n] ? [{ key: i.id, prod: prods[n]!, cantidad: String(Number(i.cantidad)), costo: Number(i.costo_unitario_original) || 0, ultima: null }] : [])));
      } catch (e) {
        if (vivo) setError((e as Error).message);
      }
    })();
    return () => { vivo = false; };
  }, [editarId]);

  function elegirProveedor(id: string | null) {
    setProveedorId(id);
    const p = proveedores.find((x) => x.id === id);
    if (!p) {
      if (id) void cargarProveedores().then(setProveedores);
      return;
    }
    setTipoPago(p.condicion_pago);
    if (p.plazo_pago_dias) setPlazo(String(p.plazo_pago_dias));
    setMoneda(p.moneda);
  }

  async function agregar(prod: ProductoInventario) {
    const ex = lineas.find((l) => l.prod.id === prod.id);
    if (ex) {
      setLineas((ls) => ls.map((l) => (l.key === ex.key ? { ...l, cantidad: String((Number(l.cantidad.replace(",", ".")) || 0) + 1) } : l)));
      return;
    }
    const key = `${prod.id}-${Date.now()}`;
    setLineas((ls) => [...ls, { key, prod, cantidad: "1", costo: 0, ultima: null }]);
    try {
      const h = await apiFetch<HistorialCostosData>(`/api/productos/${prod.id}/costos`);
      const u = h.compras[0] ? Number(h.compras[0].costo) : null;
      const base = u ?? (Number(prod.costo_promedio) || 0);
      setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, ultima: u, costo: l.costo || (moneda === "GS" ? Math.round(base) : 0) } : l)));
    } catch {
      /* sin historial */
    }
  }

  const factor = moneda === "USD" ? cambio : 1;
  const calc = useMemo(() => {
    let total = 0, unidades = 0, totalOrig = 0;
    for (const l of lineas) {
      const c = Number(l.cantidad.replace(",", ".")) || 0;
      total += Math.round(c * l.costo * factor);
      totalOrig += c * l.costo;
      unidades += c;
    }
    return { total, unidades, totalOrig };
  }, [lineas, factor]);

  const faltan = [
    !proveedorId && "el proveedor",
    moneda === "USD" && !(cambio > 0) && "la cotización del dólar",
    lineas.length === 0 && "al menos un producto",
    lineas.some((l) => !(Number(l.cantidad.replace(",", ".")) > 0)) && "la cantidad de algún producto",
  ].filter(Boolean) as string[];

  const etiquetaGuardar = busy ? "Guardando…" : editarId ? "Guardar cambios" : esSolicitud ? "Enviar solicitud" : "Crear orden de compra";

  async function guardar() {
    if (faltan.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = JSON.stringify({
        proveedor_id: proveedorId,
        fecha_entrega: entrega || null,
        tipo_pago: tipoPago,
        plazo_dias: tipoPago === "credito" ? Number(plazo) || null : null,
        moneda,
        tipo_cambio: moneda === "USD" ? cambio : null,
        observacion: observacion.trim() || null,
        idempotency_key: editarId ? null : idem,
        items: lineas.map((l) => ({ producto_id: l.prod.id, cantidad: Number(l.cantidad.replace(",", ".")), costo_unitario: l.costo || 0 })),
      });
      const r = editarId
        ? await apiFetch<{ id: string; numero_oc: string }>(`/api/ordenes-compra/${editarId}`, { method: "PATCH", body })
        : esSolicitud
        ? await apiFetch<{ id: string; numero_oc: string }>("/api/v2/compras/solicitudes", { method: "POST", body })
        : await apiFetch<{ id: string; numero_oc: string }>("/api/ordenes-compra", { method: "POST", body });
      setHecha({ id: r.id, numero: r.numero_oc });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (hecha) {
    if (esSolicitud) {
      return (
        <div className="mx-auto max-w-lg py-16 text-center">
          <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
          <h1 className="mt-4 text-2xl font-semibold text-slate-900">Solicitud enviada</h1>
          <p className="mt-1 text-sm text-slate-500">
            <strong className="font-semibold text-slate-700">{hecha.numero}</strong>. Queda a confirmación del encargado de compras;
            cuando la aprueben y confirmen el pago, se recibe la mercadería y entra al stock.
          </p>
          <div className="mt-6 flex flex-col-reverse justify-center gap-2 sm:flex-row sm:flex-wrap">
            <Link href="/compras/solicitudes/nueva" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 sm:min-h-0">Cargar otra</Link>
            <Link href="/compras/solicitudes" className="inline-flex min-h-11 items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold text-white sm:min-h-0" style={{ backgroundColor: TEAL }}>Ver solicitudes</Link>
          </div>
        </div>
      );
    }
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
        <h1 className="mt-4 text-2xl font-semibold text-slate-900">{editarId ? "Orden actualizada" : "Orden de compra creada"}</h1>
        <p className="mt-1 text-sm text-slate-500">
          <strong className="font-semibold text-slate-700">{hecha.numero}</strong>. Descargá el PDF para mandárselo al proveedor.
          Cuando llegue la mercadería, entrá a la orden y tocá <strong className="font-semibold text-slate-700">Recibir mercadería</strong>.
        </p>
        <div className="mt-6 flex flex-col-reverse justify-center gap-2 sm:flex-row sm:flex-wrap">
          <button onClick={() => descargarArchivo(`/api/ordenes-compra/${hecha.id}/pdf`, `orden-compra-${hecha.numero}.pdf`).catch(() => {})}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 sm:min-h-0">
            <Download className="h-4 w-4" /> Descargar PDF
          </button>
          <Link href="/compras/ordenes" className="inline-flex min-h-11 items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold text-white sm:min-h-0" style={{ backgroundColor: TEAL }}>Ver órdenes de compra</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-10 max-lg:pb-28 sm:space-y-6">
      <header className="flex items-start gap-3">
        <Link href={esSolicitud ? "/compras/solicitudes" : "/compras/ordenes"} aria-label={esSolicitud ? "Volver a solicitudes" : "Volver a órdenes de compra"} className="mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 sm:h-9 sm:w-9">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>{esSolicitud ? "Compras · Solicitud" : "Gastos empresariales · Compras"}</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900 [overflow-wrap:anywhere] sm:text-2xl">{numeroEditando ? `Editar ${numeroEditando}` : esSolicitud ? "Nueva solicitud de compra" : "Nueva orden de compra"}</h1>
          <p className="mt-1 text-[13px] text-slate-500 sm:text-sm">{esSolicitud ? "Tu pedido de productos a comprar. Queda a confirmación; no mueve stock." : "El pedido al proveedor. No mueve el stock: eso pasa cuando recibís la mercadería."}</p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-5 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5 sm:space-y-6">
          <Tarjeta numero={1} titulo="Proveedor y condiciones">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <span className={ET}>Proveedor *</span>
                <SelectorProveedor value={proveedorId} onChange={(id) => elegirProveedor(id)} />
              </div>
              <div className="block">
                <span className={ET}>Entrega esperada <span className="font-normal text-slate-400">(opcional)</span></span>
                <SelectorFecha block etiqueta="Entrega esperada" value={entrega} onChange={setEntrega} />
              </div>
              <div>
                <span className={ET}>Condición</span>
                <Segmentado valor={tipoPago} onChange={(v) => setTipoPago(v as "contado" | "credito")} opciones={[["contado", "Contado"], ["credito", "Crédito"]]} />
                {tipoPago === "credito" ? (
                  <div className="mt-2 flex items-center gap-2">
                    <input inputMode="numeric" enterKeyHint="done" aria-label="Plazo en días" value={plazo} onChange={(e) => setPlazo(e.target.value.replace(/\D/g, "").slice(0, 4))} className={`${INPUT} w-20 py-2 text-right tabular-nums`} />
                    <span className="text-sm text-slate-500">días</span>
                  </div>
                ) : null}
              </div>
              <div className="sm:col-span-2 sm:max-w-sm">
                <span className={ET}>Moneda</span>
                <Segmentado valor={moneda} onChange={(v) => setMoneda(v as "GS" | "USD")} opciones={[["GS", "Guaraníes"], ["USD", "Dólares"]]} />
                {moneda === "USD" ? (
                  <div className="mt-3">
                    <span className={ET}>Cotización del dólar</span>
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 whitespace-nowrap text-sm font-medium text-slate-600">1 US$ =</span>
                      <MontoInput value={cambio} onChange={setCambio} decimals={false} placeholder="7.300" aria-label="Cotización del dólar" className={`${INPUT} w-32 py-2 text-right tabular-nums`} />
                      <span className="shrink-0 text-sm text-slate-500">Gs.</span>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </Tarjeta>

          <Tarjeta numero={2} titulo="Productos a pedir" extra={lineas.length ? <span className="text-xs text-slate-500">{lineas.length} {lineas.length === 1 ? "producto" : "productos"}</span> : null}>
            <BuscadorProductos onElegir={agregar} onCrear={(t) => setCreandoProd(t)} />
            {creandoProd !== null ? (
              <ProductoForm modal inicial={{ nombre: creandoProd, proveedor_principal_id: proveedorId }}
                onClose={() => setCreandoProd(null)}
                onSaved={async (c) => {
                  setCreandoProd(null);
                  // El producto recién creado entra solo a la lista.
                  if (c?.id) { try { void agregar(await apiFetch<ProductoInventario>(`/api/productos/${c.id}`)); } catch { /* lo busca a mano */ } }
                }} />
            ) : null}
            {lineas.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center">
                <Package className="mx-auto h-7 w-7 text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">Buscá los productos que le vas a pedir.</p>
                <Link href="/reportes/stock-minimo" className="mt-1 inline-block text-xs font-semibold text-[var(--brand)] hover:underline [@media(pointer:coarse)]:-my-3 [@media(pointer:coarse)]:inline-flex [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:items-center">Ver qué está por debajo del stock mínimo</Link>
              </div>
            ) : (
              <ul className="mt-4 space-y-2">
                {lineas.map((l) => {
                  const c = Number(l.cantidad.replace(",", ".")) || 0;
                  return (
                    // Celular / tablet chica: tarjeta (nombre + quitar arriba, cantidad y costo en 2
                    // columnas, total abajo). Desde md: una fila como siempre (sm/md:contents).
                    <li key={l.key} className="rounded-xl border border-slate-200 p-3 md:flex md:flex-wrap md:items-center md:gap-3">
                      <div className="flex items-start gap-2 md:contents">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-900 max-md:line-clamp-2 max-md:[overflow-wrap:anywhere] md:truncate">{l.prod.nombre}</p>
                          <p className="text-[11px] text-slate-500">
                            <span className="font-mono">{l.prod.sku}</span> · stock {Number(l.prod.stock_actual).toLocaleString("es-PY")}
                            {Number(l.prod.stock_minimo) > 0 ? ` · mínimo ${Number(l.prod.stock_minimo).toLocaleString("es-PY")}` : ""}
                            {l.ultima ? ` · última compra ${gs(l.ultima)}` : ""}
                          </p>
                        </div>
                        <button type="button" onClick={() => setLineas((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Quitar ${l.prod.nombre}`}
                          className="-mr-1.5 -mt-1.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 md:hidden"><Trash2 className="h-4 w-4" /></button>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 md:contents">
                        <label className="flex flex-col justify-end md:block md:w-24">
                          <span className={ET}>Cantidad</span>
                          <input inputMode="decimal" enterKeyHint="next" aria-label={`Cantidad de ${l.prod.nombre}`} value={l.cantidad} onChange={(e) => setLineas((ls) => ls.map((x) => (x.key === l.key ? { ...x, cantidad: e.target.value.replace(/[^\d.,]/g, "") } : x)))} className={`${INPUT} py-2 text-right tabular-nums`} />
                        </label>
                        <label className="flex flex-col justify-end md:block md:w-32">
                          <span className={ET}>Costo estimado {moneda === "USD" ? "(US$)" : ""}</span>
                          <MontoInput value={l.costo} onChange={(v) => setLineas((ls) => ls.map((x) => (x.key === l.key ? { ...x, costo: v } : x)))} decimals={moneda === "USD"} placeholder="0" className={`${INPUT} py-2 text-right tabular-nums`} />
                        </label>
                      </div>
                      <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-slate-100 pt-2 md:contents">
                        <span className="text-xs text-slate-500 md:hidden">Total de la línea</span>
                        <p className="text-right text-base font-bold tabular-nums text-slate-900 md:w-28 md:text-sm">{gs(Math.round(c * l.costo * factor))}</p>
                      </div>
                      <button type="button" onClick={() => setLineas((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Quitar ${l.prod.nombre}`} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 max-md:hidden"><Trash2 className="h-4 w-4" /></button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Tarjeta>
        </div>

        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Resumen del pedido</p>
            <dl className="mt-3 space-y-1.5 text-sm">
              <Fila l="Productos" v={String(lineas.length)} />
              <Fila l="Unidades" v={calc.unidades.toLocaleString("es-PY", { maximumFractionDigits: 3 })} />
            </dl>
            <div className="mt-3 flex items-baseline justify-between border-t border-slate-100 pt-3">
              <span className="text-sm font-semibold text-slate-800">Total estimado</span>
              <span className="text-2xl font-extrabold tabular-nums text-slate-900">{gs(calc.total)}</span>
            </div>
            {moneda === "USD" ? <p className="text-right text-xs text-slate-500">{usd(calc.totalOrig)}</p> : null}
            <label className="mt-4 block">
              <span className={ET}>Observación para el proveedor <span className="font-normal text-slate-400">(opcional)</span></span>
              <textarea value={observacion} onChange={(e) => setObservacion(e.target.value)} rows={3} maxLength={2000} placeholder="Ej: entregar por la mañana, en el depósito de atrás" className={INPUT} />
            </label>
            {faltan.length ? <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">Falta: {faltan.join(", ")}.</p> : null}
            {error ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
            {/* En celular / tablet el botón va en el pie fijo (abajo). */}
            <button onClick={guardar} disabled={!!faltan.length || busy}
              className="mt-4 hidden w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-40 lg:inline-flex" style={{ backgroundColor: TEAL }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {etiquetaGuardar}
            </button>
            {esSolicitud ? null : <p className="mt-2 text-center text-[11px] text-slate-400">Después podés descargar el PDF para mandárselo.</p>}
          </div>
        </aside>
      </div>

      {/* Celular / tablet: total estimado y "Crear orden" en un pie fijo (safe-area) */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 shadow-[0_-10px_30px_-12px_rgba(15,23,42,0.28)] backdrop-blur pb-safe lg:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-3 py-2.5 sm:px-4">
          <div className="min-w-0 flex-1">
            <p className={`truncate text-[11px] ${error ? "font-semibold text-rose-600" : "text-slate-500"}`}>
              {error ? error : faltan.length ? `Falta: ${faltan[0]}${faltan.length > 1 ? ` y ${faltan.length - 1} más` : ""}` : `Total estimado · ${lineas.length} producto${lineas.length === 1 ? "" : "s"}`}
            </p>
            <p className="truncate text-xl font-bold leading-tight tabular-nums text-slate-900">{gs(calc.total)}</p>
          </div>
          <button type="button" onClick={() => void guardar()} disabled={!!faltan.length || busy}
            className="inline-flex h-12 max-w-[60%] shrink-0 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-40" style={{ backgroundColor: TEAL }}>
            {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
            <span className="truncate">{busy ? "Guardando…" : editarId ? "Guardar cambios" : esSolicitud ? "Enviar solicitud" : "Crear orden"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
