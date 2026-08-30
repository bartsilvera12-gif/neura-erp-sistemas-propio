"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import { getCuentasContablesOpciones, type CuentaContableOpcion } from "@/lib/compras/storage";
import { getProveedores } from "@/lib/proveedores/storage";
import { getProductos } from "@/lib/inventario/storage";
import CuentaCombobox from "@/components/contabilidad/CuentaCombobox";
import SmartCombobox, { type ComboOption } from "@/components/ui/SmartCombobox";
import { FechaSelect } from "@/components/ui/FechaSelect";

/* ── tipos ─────────────────────────────────────────────────────────────── */
interface Orden {
  id: string; numero: string; proveedor_id: string; proveedor_nombre: string | null;
  fecha: string; fecha_estimada: string | null; observaciones: string | null;
  moneda: string; total_estimado: string | number; estado: string;
  motivo_cierre: string | null; motivo_cancelacion: string | null;
  cant_solicitada?: number; cant_recibida?: number; cant_pendiente?: number;
  cant_facturada?: number; cant_pend_facturar?: number;
}
interface OrdenItem {
  id: string; producto_id: string | null; producto_nombre: string | null; descripcion: string | null;
  cantidad: string | number; costo_unitario_estimado: string | number; iva_tipo: string;
  cuenta_contable_id: string | null; recibida: string | number; facturada: string | number;
}
type IvaTipo = "exenta" | "5" | "10";
interface FormLinea {
  producto_id: string | null; producto_nombre: string; descripcion: string;
  cantidad: string; costo_unitario_estimado: string; iva_tipo: IvaTipo; cuenta_contable_id: string | null;
}

/* ── helpers ───────────────────────────────────────────────────────────── */
const fmt = (v: number | string) => Math.round(Number(v) || 0).toLocaleString("es-PY");
const n = (v: string | number) => Number(v) || 0;
const hoy = () => new Date().toISOString().slice(0, 10);
const primerDiaMes = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; };
const uuid = () =>
  (globalThis.crypto?.randomUUID?.() ??
    "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)));

const ESTADOS: Record<string, { label: string; cls: string }> = {
  borrador: { label: "Borrador", cls: "bg-slate-100 text-slate-600" },
  aprobada: { label: "Aprobada", cls: "bg-blue-50 text-blue-700" },
  parcialmente_recibida: { label: "Parcialmente recibida", cls: "bg-amber-50 text-amber-700" },
  recibida: { label: "Recibida", cls: "bg-teal-50 text-teal-700" },
  cerrada: { label: "Cerrada", cls: "bg-emerald-50 text-emerald-700" },
  cancelada: { label: "Cancelada", cls: "bg-red-50 text-red-700" },
};
const INPUT = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/40";
const lineaVacia = (): FormLinea => ({
  producto_id: null, producto_nombre: "", descripcion: "", cantidad: "",
  costo_unitario_estimado: "", iva_tipo: "10", cuenta_contable_id: null,
});

/* ── página ────────────────────────────────────────────────────────────── */
export default function OrdenesClient() {
  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [desde, setDesde] = useState(primerDiaMes());
  const [hasta, setHasta] = useState(hoy());
  const [filtroEstado, setFiltroEstado] = useState("");
  const [busqueda, setBusqueda] = useState("");

  const [proveedores, setProveedores] = useState<ComboOption[]>([]);
  const [productos, setProductos] = useState<ComboOption[]>([]);
  const [cuentas, setCuentas] = useState<CuentaContableOpcion[]>([]);

  const [modalAbierto, setModalAbierto] = useState(false);
  const [detalle, setDetalle] = useState<{ orden: Orden; items: OrdenItem[]; tiene_recepciones: boolean } | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const p = new URLSearchParams();
      if (desde) p.set("desde", desde);
      if (hasta) p.set("hasta", hasta);
      if (filtroEstado) p.set("estado", filtroEstado);
      const r = await apiFetch(`/api/ordenes?${p.toString()}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) { setError(j?.error ?? `Error ${r.status}`); setOrdenes([]); return; }
      setOrdenes(j.data.ordenes as Orden[]);
    } catch (e) { setError(e instanceof Error ? e.message : "Error de red"); }
    finally { setLoading(false); }
  }, [desde, hasta, filtroEstado]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    getProveedores().then((ps) => setProveedores(ps.map((p) => ({ id: p.id, label: p.nombre, sub: p.ruc ?? null })))).catch(() => {});
    getProductos().then((ps) => setProductos(ps.map((p) => ({ id: p.id, label: p.nombre, sub: p.sku })))).catch(() => {});
    getCuentasContablesOpciones().then(setCuentas).catch(() => {});
  }, []);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return ordenes;
    return ordenes.filter((o) =>
      `${o.numero} ${o.proveedor_nombre ?? ""}`.toLowerCase().includes(q));
  }, [ordenes, busqueda]);

  async function abrirDetalle(id: string) {
    setError(null);
    const r = await apiFetch(`/api/ordenes/${id}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) { setError(j?.error ?? `Error ${r.status}`); return; }
    setDetalle(j.data);
  }

  return (
    <div className="w-full min-w-0 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <nav className="mb-1 text-xs text-slate-500">
            <Link href="/compras" className="hover:text-[#4FAEB2]">Compras</Link> /{" "}
            <span className="font-semibold text-slate-700">Órdenes de Compra</span>
          </nav>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Órdenes de Compra</h1>
          <p className="mt-1 text-sm text-slate-500">
            Documento de intención: no mueve inventario, no genera deuda ni asiento contable. Habilita recepciones y facturas.
          </p>
        </div>
        <button onClick={() => setModalAbierto(true)}
          className="rounded-xl bg-[#4FAEB2] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#3F8E91]">
          Nueva orden de compra
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3 lg:grid-cols-5">
        <label className="text-xs font-semibold text-slate-500">Desde
          <FechaSelect value={desde} onChange={(e) => setDesde(e.target.value)} className={`mt-1 ${INPUT}`} /></label>
        <label className="text-xs font-semibold text-slate-500">Hasta
          <FechaSelect value={hasta} onChange={(e) => setHasta(e.target.value)} className={`mt-1 ${INPUT}`} /></label>
        <label className="text-xs font-semibold text-slate-500">Estado
          <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)} className={`mt-1 ${INPUT}`}>
            <option value="">Todos</option>
            {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select></label>
        <label className="col-span-2 text-xs font-semibold text-slate-500">Buscar
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="N° de orden o proveedor"
            className={`mt-1 ${INPUT}`} /></label>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="border-b bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2.5 text-left">Orden</th>
              <th className="px-3 py-2.5 text-left">Fecha</th>
              <th className="px-3 py-2.5 text-left">Proveedor</th>
              <th className="px-3 py-2.5 text-right">Solicitado</th>
              <th className="px-3 py-2.5 text-right">Recibido</th>
              <th className="px-3 py-2.5 text-right">Pendiente</th>
              <th className="px-3 py-2.5 text-right">Facturado</th>
              <th className="px-3 py-2.5 text-right">Pend. facturar</th>
              <th className="px-3 py-2.5 text-right">Total estimado</th>
              <th className="px-3 py-2.5 text-left">Estado</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="px-3 py-8 text-center text-slate-400">Cargando…</td></tr>
            ) : visibles.length === 0 ? (
              <tr><td colSpan={11} className="px-3 py-8 text-center text-slate-400">Sin órdenes en el período.</td></tr>
            ) : visibles.map((o) => {
              const e = ESTADOS[o.estado] ?? { label: o.estado, cls: "bg-slate-100 text-slate-600" };
              return (
                <tr key={o.id} className="border-b last:border-0 hover:bg-slate-50/60">
                  <td className="px-3 py-2 font-mono text-xs font-semibold text-slate-800">{o.numero}</td>
                  <td className="px-3 py-2">{(o.fecha ?? "").slice(0, 10)}</td>
                  <td className="px-3 py-2">{o.proveedor_nombre ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(o.cant_solicitada ?? 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(o.cant_recibida ?? 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-amber-700">{fmt(o.cant_pendiente ?? 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(o.cant_facturada ?? 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-blue-700">{fmt(o.cant_pend_facturar ?? 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(o.total_estimado)}</td>
                  <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-xs font-medium ${e.cls}`}>{e.label}</span></td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => abrirDetalle(o.id)} className="text-xs font-semibold text-[#3F8E91] hover:underline">Ver</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modalAbierto && (
        <ModalOrden proveedores={proveedores} productos={productos} cuentas={cuentas}
          onClose={() => setModalAbierto(false)} onSaved={() => { setModalAbierto(false); cargar(); }} />
      )}
      {detalle && (
        <ModalDetalle data={detalle} onClose={() => setDetalle(null)}
          onChanged={() => { cargar(); abrirDetalle(detalle.orden.id); }} />
      )}
    </div>
  );
}

/* ── modal: nueva orden ────────────────────────────────────────────────── */
function ModalOrden({ proveedores, productos, cuentas, onClose, onSaved }: {
  proveedores: ComboOption[]; productos: ComboOption[]; cuentas: CuentaContableOpcion[];
  onClose: () => void; onSaved: () => void;
}) {
  const [proveedorId, setProveedorId] = useState<string | null>(null);
  const [fecha, setFecha] = useState(hoy());
  const [fechaEstimada, setFechaEstimada] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [lineas, setLineas] = useState<FormLinea[]>([lineaVacia()]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idem] = useState(uuid);

  const total = lineas.reduce((s, l) => s + n(l.cantidad) * n(l.costo_unitario_estimado), 0);
  const set = (i: number, patch: Partial<FormLinea>) =>
    setLineas((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  async function guardar() {
    setError(null);
    if (!proveedorId) { setError("Seleccioná un proveedor."); return; }
    if (lineas.some((l) => n(l.cantidad) <= 0)) { setError("Todas las líneas necesitan una cantidad mayor a 0."); return; }
    setGuardando(true);
    try {
      const r = await apiFetch("/api/ordenes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proveedor_id: proveedorId,
          proveedor_nombre: proveedores.find((p) => p.id === proveedorId)?.label ?? "",
          fecha, fecha_estimada: fechaEstimada || null, observaciones: observaciones || null,
          moneda: "PYG", tipo_cambio: 1, idempotency_key: idem,
          items: lineas.map((l) => ({
            producto_id: l.producto_id,
            producto_nombre: l.producto_id ? productos.find((p) => p.id === l.producto_id)?.label ?? "" : l.producto_nombre,
            descripcion: l.descripcion || null,
            cantidad: n(l.cantidad),
            costo_unitario_estimado: n(l.costo_unitario_estimado),
            iva_tipo: l.iva_tipo,
            cuenta_contable_id: l.cuenta_contable_id,
          })),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) { setError(j?.error ?? `Error ${r.status}`); return; }
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Error de red"); }
    finally { setGuardando(false); }
  }

  return (
    <Overlay onClose={onClose} titulo="Nueva orden de compra">
      {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div><label className="text-xs font-semibold text-slate-500">Proveedor *</label>
          <div className="mt-1"><SmartCombobox options={proveedores} value={proveedorId} onChange={setProveedorId} placeholder="(Elegir proveedor)" /></div></div>
        <label className="text-xs font-semibold text-slate-500">Fecha
          <FechaSelect value={fecha} onChange={(e) => setFecha(e.target.value)} className={`mt-1 ${INPUT}`} /></label>
        <label className="text-xs font-semibold text-slate-500">Fecha estimada de entrega
          <FechaSelect value={fechaEstimada} onChange={(e) => setFechaEstimada(e.target.value)} className={`mt-1 ${INPUT}`} /></label>
      </div>

      <div className="mt-4 space-y-3">
        {lineas.map((l, i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-slate-50/50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">Ítem {i + 1}</span>
              {lineas.length > 1 && (
                <button onClick={() => setLineas((ls) => ls.filter((_, idx) => idx !== i))}
                  className="text-xs font-semibold text-red-600 hover:underline">Quitar</button>
              )}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div><label className="text-xs font-semibold text-slate-500">Cuenta contable</label>
                <div className="mt-1"><CuentaCombobox cuentas={cuentas} value={l.cuenta_contable_id}
                  onChange={(id) => set(i, { cuenta_contable_id: id })} /></div></div>
              <div><label className="text-xs font-semibold text-slate-500">Producto</label>
                <div className="mt-1"><SmartCombobox options={productos} value={l.producto_id}
                  onChange={(id) => set(i, { producto_id: id })} placeholder="(Sin producto de inventario)" /></div></div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="text-xs font-semibold text-slate-500">Descripción
                <input value={l.descripcion} onChange={(e) => set(i, { descripcion: e.target.value })} className={`mt-1 ${INPUT}`} /></label>
              <label className="text-xs font-semibold text-slate-500">Cantidad *
                <input inputMode="decimal" value={l.cantidad} onChange={(e) => set(i, { cantidad: e.target.value })}
                  className={`mt-1 ${INPUT} text-right`} /></label>
              <label className="text-xs font-semibold text-slate-500">Costo estimado
                <input inputMode="decimal" value={l.costo_unitario_estimado}
                  onChange={(e) => set(i, { costo_unitario_estimado: e.target.value })} className={`mt-1 ${INPUT} text-right`} /></label>
              <label className="text-xs font-semibold text-slate-500">IVA
                <select value={l.iva_tipo} onChange={(e) => set(i, { iva_tipo: e.target.value as IvaTipo })} className={`mt-1 ${INPUT}`}>
                  <option value="10">10%</option><option value="5">5%</option><option value="exenta">Exenta</option>
                </select></label>
            </div>
            <p className="mt-2 text-right text-xs text-slate-500">
              Subtotal estimado: <b className="text-slate-800">{fmt(n(l.cantidad) * n(l.costo_unitario_estimado))}</b>
            </p>
          </div>
        ))}
        <button onClick={() => setLineas((ls) => [...ls, lineaVacia()])}
          className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm font-semibold text-[#3F8E91] hover:bg-[#4FAEB2]/5">
          + Agregar ítem
        </button>
      </div>

      <label className="mt-4 block text-xs font-semibold text-slate-500">Observaciones
        <textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={2} className={`mt-1 ${INPUT}`} /></label>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <span className="text-sm text-slate-600">Total estimado: <b className="text-lg text-slate-900">{fmt(total)}</b></span>
        <div className="flex gap-2">
          <button onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancelar</button>
          <button onClick={guardar} disabled={guardando}
            className="rounded-xl bg-[#4FAEB2] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-60">
            {guardando ? "Guardando…" : "Crear orden"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/* ── modal: detalle + acciones + recepción ─────────────────────────────── */
function ModalDetalle({ data, onClose, onChanged }: {
  data: { orden: Orden; items: OrdenItem[]; tiene_recepciones: boolean };
  onClose: () => void; onChanged: () => void;
}) {
  const { orden, items } = data;
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modoRecepcion, setModoRecepcion] = useState(false);
  const e = ESTADOS[orden.estado] ?? { label: orden.estado, cls: "bg-slate-100 text-slate-600" };

  async function accion(tipo: "aprobar" | "cancelar" | "cerrar") {
    setError(null); setOk(null);
    let motivo: string | null = null;
    if (tipo !== "aprobar") {
      motivo = window.prompt(tipo === "cancelar" ? "Motivo de la cancelación:" : "Motivo del cierre manual:");
      if (!motivo?.trim()) { setError("Se requiere un motivo."); return; }
    }
    setBusy(true);
    try {
      const r = await apiFetch(`/api/ordenes/${orden.id}/estado`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: tipo, motivo }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) { setError(j?.error ?? `Error ${r.status}`); return; }
      setOk("Orden actualizada."); onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : "Error de red"); }
    finally { setBusy(false); }
  }

  const puedeRecibir = ["aprobada", "parcialmente_recibida", "recibida"].includes(orden.estado);

  return (
    <Overlay onClose={onClose} titulo={`Orden ${orden.numero}`}>
      {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {ok && <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{ok}</div>}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-slate-600">
        <span>Proveedor: <b className="text-slate-800">{orden.proveedor_nombre ?? "—"}</b></span>
        <span>Fecha: <b className="text-slate-800">{(orden.fecha ?? "").slice(0, 10)}</b></span>
        {orden.fecha_estimada && <span>Entrega estimada: <b className="text-slate-800">{orden.fecha_estimada.slice(0, 10)}</b></span>}
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${e.cls}`}>{e.label}</span>
      </div>
      {orden.observaciones && <p className="mt-2 text-sm text-slate-500">{orden.observaciones}</p>}
      {orden.motivo_cierre && <p className="mt-2 text-sm text-emerald-700">Cierre: {orden.motivo_cierre}</p>}
      {orden.motivo_cancelacion && <p className="mt-2 text-sm text-red-700">Cancelación: {orden.motivo_cancelacion}</p>}

      {modoRecepcion ? (
        <FormRecepcion orden={orden} items={items}
          onCancel={() => setModoRecepcion(false)}
          onSaved={() => { setModoRecepcion(false); setOk("Recepción registrada: el stock se actualizó."); onChanged(); }} />
      ) : (
        <>
          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="border-b bg-slate-50 uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-2 py-1.5 text-left">Ítem</th>
                  <th className="px-2 py-1.5 text-right">Solicitado</th>
                  <th className="px-2 py-1.5 text-right">Recibido</th>
                  <th className="px-2 py-1.5 text-right">Pendiente</th>
                  <th className="px-2 py-1.5 text-right">Facturado</th>
                  <th className="px-2 py-1.5 text-right">Pend. facturar</th>
                  <th className="px-2 py-1.5 text-right">Costo est.</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-b last:border-0">
                    <td className="px-2 py-1.5">{it.producto_nombre || it.descripcion || "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(it.cantidad)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(it.recibida)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-amber-700">{fmt(n(it.cantidad) - n(it.recibida))}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(it.facturada)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-blue-700">{fmt(n(it.recibida) - n(it.facturada))}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(it.costo_unitario_estimado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
            {orden.estado === "borrador" && (
              <button onClick={() => accion("aprobar")} disabled={busy}
                className="rounded-xl bg-[#4FAEB2] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-60">Aprobar</button>
            )}
            {puedeRecibir && (
              <button onClick={() => setModoRecepcion(true)}
                className="rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-900">Registrar recepción</button>
            )}
            {!["cerrada", "cancelada"].includes(orden.estado) && (
              <>
                <button onClick={() => accion("cerrar")} disabled={busy}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">Cerrar manualmente</button>
                {!data.tiene_recepciones && (
                  <button onClick={() => accion("cancelar")} disabled={busy}
                    className="rounded-xl border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60">Cancelar orden</button>
                )}
              </>
            )}
            <Link href="/compras/recepciones"
              className="ml-auto self-center text-sm font-semibold text-[#3F8E91] hover:underline">Ver recepciones →</Link>
          </div>
        </>
      )}
    </Overlay>
  );
}

/* ── formulario de recepción (dentro del detalle de la orden) ──────────── */
function FormRecepcion({ orden, items, onCancel, onSaved }: {
  orden: Orden; items: OrdenItem[]; onCancel: () => void; onSaved: () => void;
}) {
  const [fecha, setFecha] = useState(hoy());
  const [ubicacionId, setUbicacionId] = useState<string | null>(null);
  const [ubicaciones, setUbicaciones] = useState<ComboOption[]>([]);
  const [observacion, setObservacion] = useState("");
  const [documentoUrl, setDocumentoUrl] = useState("");
  const [permitirExcedente, setPermitirExcedente] = useState(false);
  const [motivoExcedente, setMotivoExcedente] = useState("");
  const [cant, setCant] = useState<Record<string, string>>({});
  const [costo, setCosto] = useState<Record<string, string>>(
    Object.fromEntries(items.map((i) => [i.id, String(Math.round(n(i.costo_unitario_estimado)))]))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idem] = useState(uuid);

  useEffect(() => {
    apiFetch("/api/inventario/ubicaciones").then(async (r) => {
      const j = await r.json().catch(() => ({}));
      const list = (j?.data?.ubicaciones ?? []) as { id: string; nombre: string; codigo?: string | null }[];
      setUbicaciones(list.map((u) => ({ id: u.id, label: u.nombre, sub: u.codigo ?? null })));
    }).catch(() => {});
  }, []);

  const excede = items.some((it) => n(cant[it.id] ?? "") > n(it.cantidad) - n(it.recibida));

  async function confirmar() {
    setError(null);
    const payloadItems = items
      .filter((it) => n(cant[it.id] ?? "") > 0)
      .map((it) => ({
        orden_item_id: it.id,
        cantidad_recibida: n(cant[it.id]),
        costo_unitario_recibido: n(costo[it.id] ?? "0"),
      }));
    if (payloadItems.length === 0) { setError("Cargá al menos una cantidad recibida."); return; }
    if (excede && !permitirExcedente) { setError("Estás recibiendo más de lo pendiente. Habilitá la recepción excedente."); return; }
    if (excede && !motivoExcedente.trim()) { setError("Indicá el motivo de la recepción excedente."); return; }
    setBusy(true);
    try {
      const r = await apiFetch("/api/recepciones", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orden_id: orden.id, fecha, ubicacion_id: ubicacionId, observacion: observacion || null,
          documento_url: documentoUrl || null, items: payloadItems,
          permitir_excedente: permitirExcedente, motivo_excedente: motivoExcedente || null,
          idempotency_key: idem,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) { setError(j?.error ?? `Error ${r.status}`); return; }
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Error de red"); }
    finally { setBusy(false); }
  }

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <h3 className="text-sm font-semibold text-slate-800">Registrar recepción</h3>
      <p className="mt-0.5 text-xs text-slate-500">
        La recepción aumenta el stock. No genera asiento contable ni Libro de Compras: eso se hace al registrar la factura.
      </p>
      {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="text-xs font-semibold text-slate-500">Fecha
          <FechaSelect value={fecha} onChange={(e) => setFecha(e.target.value)} className={`mt-1 ${INPUT}`} /></label>
        <div><label className="text-xs font-semibold text-slate-500">Depósito / Ubicación</label>
          <div className="mt-1"><SmartCombobox options={ubicaciones} value={ubicacionId} onChange={setUbicacionId} placeholder="(Sin ubicación)" /></div></div>
        <label className="text-xs font-semibold text-slate-500">Documento (URL, opcional)
          <input value={documentoUrl} onChange={(e) => setDocumentoUrl(e.target.value)} className={`mt-1 ${INPUT}`} /></label>
      </div>

      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[720px] text-xs">
          <thead className="border-b bg-slate-50 uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-2 py-1.5 text-left">Ítem</th>
              <th className="px-2 py-1.5 text-right">Solicitado</th>
              <th className="px-2 py-1.5 text-right">Recibido antes</th>
              <th className="px-2 py-1.5 text-right">Pendiente</th>
              <th className="px-2 py-1.5 text-right">Recibir ahora</th>
              <th className="px-2 py-1.5 text-right">Costo unitario</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const pendiente = n(it.cantidad) - n(it.recibida);
              const ahora = n(cant[it.id] ?? "");
              return (
                <tr key={it.id} className="border-b last:border-0">
                  <td className="px-2 py-1.5">{it.producto_nombre || it.descripcion || "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(it.cantidad)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(it.recibida)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fmt(pendiente)}</td>
                  <td className="px-2 py-1.5 text-right">
                    <input inputMode="decimal" value={cant[it.id] ?? ""}
                      onChange={(ev) => setCant((c) => ({ ...c, [it.id]: ev.target.value }))}
                      className={`w-24 rounded-lg border px-2 py-1 text-right text-xs ${ahora > pendiente ? "border-amber-400 bg-amber-50" : "border-slate-200"}`} />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <input inputMode="decimal" value={costo[it.id] ?? ""}
                      onChange={(ev) => setCosto((c) => ({ ...c, [it.id]: ev.target.value }))}
                      className="w-28 rounded-lg border border-slate-200 px-2 py-1 text-right text-xs" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {excede && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-amber-800">
            <input type="checkbox" checked={permitirExcedente} onChange={(e) => setPermitirExcedente(e.target.checked)} />
            Confirmo la recepción excedente (recibo más de lo pendiente)
          </label>
          <input value={motivoExcedente} onChange={(e) => setMotivoExcedente(e.target.value)}
            placeholder="Motivo del excedente (queda auditado)" className={`mt-2 ${INPUT}`} />
        </div>
      )}

      <label className="mt-3 block text-xs font-semibold text-slate-500">Observación
        <textarea value={observacion} onChange={(e) => setObservacion(e.target.value)} rows={2} className={`mt-1 ${INPUT}`} /></label>

      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">Volver</button>
        <button onClick={confirmar} disabled={busy}
          className="rounded-xl bg-[#4FAEB2] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-60">
          {busy ? "Confirmando…" : "Confirmar recepción"}
        </button>
      </div>
    </div>
  );
}

/* ── overlay reutilizable ──────────────────────────────────────────────── */
export function Overlay({ titulo, children, onClose }: { titulo: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
      <div className="my-8 w-full max-w-5xl rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">{titulo}</h2>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
