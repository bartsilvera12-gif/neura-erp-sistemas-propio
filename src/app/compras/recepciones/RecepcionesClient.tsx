"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import { getCuentasContablesOpciones, type CuentaContableOpcion } from "@/lib/compras/storage";
import CuentaCombobox from "@/components/contabilidad/CuentaCombobox";
import { Overlay } from "@/app/compras/ordenes/OrdenesClient";
import { FechaSelect } from "@/components/ui/FechaSelect";

interface Recepcion {
  id: string; numero: string; orden_id: string; orden_numero?: string | null;
  proveedor_id: string | null; proveedor_nombre: string | null;
  fecha: string; ubicacion_nombre?: string | null; observacion: string | null;
  estado: string; estado_facturacion: string; excedente_confirmado: boolean;
  cant_recibida?: number; cant_facturada?: number; cant_pend_facturar?: number;
}
interface RecepcionItem {
  id: string; producto_id: string | null; producto_nombre: string | null;
  cantidad_recibida: string | number; costo_unitario_recibido: string | number;
  cantidad_facturada: string | number; iva_tipo?: string | null;
  cuenta_contable_id?: string | null; costo_unitario_estimado?: string | number | null;
}
type IvaTipo = "exenta" | "5" | "10";

const fmt = (v: number | string) => Math.round(Number(v) || 0).toLocaleString("es-PY");
const n = (v: string | number | null | undefined) => Number(v) || 0;
const hoy = () => new Date().toISOString().slice(0, 10);
const primerDiaMes = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; };
const uuid = () =>
  (globalThis.crypto?.randomUUID?.() ??
    "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)));
const INPUT = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/40";

const FACT: Record<string, { label: string; cls: string }> = {
  pendiente: { label: "Pendiente de facturar", cls: "bg-blue-50 text-blue-700" },
  parcial: { label: "Parcialmente facturada", cls: "bg-amber-50 text-amber-700" },
  facturada: { label: "Facturada", cls: "bg-emerald-50 text-emerald-700" },
};

export default function RecepcionesClient() {
  const [recepciones, setRecepciones] = useState<Recepcion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [desde, setDesde] = useState(primerDiaMes());
  const [hasta, setHasta] = useState(hoy());
  const [filtro, setFiltro] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [cuentas, setCuentas] = useState<CuentaContableOpcion[]>([]);
  const [facturar, setFacturar] = useState<{ recepcion: Recepcion; items: RecepcionItem[] } | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const p = new URLSearchParams();
      if (desde) p.set("desde", desde);
      if (hasta) p.set("hasta", hasta);
      if (filtro) p.set("estado_facturacion", filtro);
      const r = await apiFetch(`/api/recepciones?${p.toString()}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) { setError(j?.error ?? `Error ${r.status}`); setRecepciones([]); return; }
      setRecepciones(j.data.recepciones as Recepcion[]);
    } catch (e) { setError(e instanceof Error ? e.message : "Error de red"); }
    finally { setLoading(false); }
  }, [desde, hasta, filtro]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { getCuentasContablesOpciones().then(setCuentas).catch(() => {}); }, []);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return recepciones;
    return recepciones.filter((r) =>
      `${r.numero} ${r.orden_numero ?? ""} ${r.proveedor_nombre ?? ""}`.toLowerCase().includes(q));
  }, [recepciones, busqueda]);

  async function abrirFacturar(rec: Recepcion) {
    setError(null);
    const r = await apiFetch(`/api/recepciones/${rec.id}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) { setError(j?.error ?? `Error ${r.status}`); return; }
    setFacturar({ recepcion: j.data.recepcion as Recepcion, items: j.data.items as RecepcionItem[] });
  }

  return (
    <div className="w-full min-w-0 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <nav className="mb-1 text-xs text-slate-500">
            <Link href="/compras" className="hover:text-[#4FAEB2]">Compras</Link> /{" "}
            <span className="font-semibold text-slate-700">Recepciones</span>
          </nav>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Recepciones</h1>
          <p className="mt-1 text-sm text-slate-500">
            Entrada física de mercadería. Aumentan el stock una sola vez; lo fiscal y contable se registra al facturar.
          </p>
        </div>
        <Link href="/compras/ordenes"
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-[#3F8E91] hover:bg-[#4FAEB2]/5">
          Ir a Órdenes de Compra
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3 lg:grid-cols-5">
        <label className="text-xs font-semibold text-slate-500">Desde
          <FechaSelect value={desde} onChange={(e) => setDesde(e.target.value)} className={`mt-1 ${INPUT}`} /></label>
        <label className="text-xs font-semibold text-slate-500">Hasta
          <FechaSelect value={hasta} onChange={(e) => setHasta(e.target.value)} className={`mt-1 ${INPUT}`} /></label>
        <label className="text-xs font-semibold text-slate-500">Facturación
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)} className={`mt-1 ${INPUT}`}>
            <option value="">Todas</option>
            {Object.entries(FACT).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select></label>
        <label className="col-span-2 text-xs font-semibold text-slate-500">Buscar
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="N° recepción, orden o proveedor"
            className={`mt-1 ${INPUT}`} /></label>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-b bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2.5 text-left">Recepción</th>
              <th className="px-3 py-2.5 text-left">Orden</th>
              <th className="px-3 py-2.5 text-left">Fecha</th>
              <th className="px-3 py-2.5 text-left">Proveedor</th>
              <th className="px-3 py-2.5 text-left">Depósito</th>
              <th className="px-3 py-2.5 text-right">Recibido</th>
              <th className="px-3 py-2.5 text-right">Facturado</th>
              <th className="px-3 py-2.5 text-right">Pend. facturar</th>
              <th className="px-3 py-2.5 text-left">Estado</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400">Cargando…</td></tr>
            ) : visibles.length === 0 ? (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400">Sin recepciones en el período.</td></tr>
            ) : visibles.map((r) => {
              const f = FACT[r.estado_facturacion] ?? { label: r.estado_facturacion, cls: "bg-slate-100 text-slate-600" };
              return (
                <tr key={r.id} className="border-b last:border-0 hover:bg-slate-50/60">
                  <td className="px-3 py-2 font-mono text-xs font-semibold text-slate-800">
                    {r.numero}
                    {r.excedente_confirmado && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-700">excedente</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.orden_numero ?? "—"}</td>
                  <td className="px-3 py-2">{(r.fecha ?? "").slice(0, 10)}</td>
                  <td className="px-3 py-2">{r.proveedor_nombre ?? "—"}</td>
                  <td className="px-3 py-2">{r.ubicacion_nombre ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(r.cant_recibida ?? 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(r.cant_facturada ?? 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-blue-700">{fmt(r.cant_pend_facturar ?? 0)}</td>
                  <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-xs font-medium ${f.cls}`}>{f.label}</span></td>
                  <td className="px-3 py-2 text-right">
                    {r.estado_facturacion !== "facturada" ? (
                      <button onClick={() => abrirFacturar(r)} className="text-xs font-semibold text-[#3F8E91] hover:underline">
                        Crear compra / registrar factura
                      </button>
                    ) : <span className="text-xs text-slate-400">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {facturar && (
        <ModalFacturar data={facturar} cuentas={cuentas}
          onClose={() => setFacturar(null)}
          onSaved={() => { setFacturar(null); cargar(); }} />
      )}
    </div>
  );
}

/* ── modal: crear compra desde recepción ───────────────────────────────── */
function ModalFacturar({ data, cuentas, onClose, onSaved }: {
  data: { recepcion: Recepcion; items: RecepcionItem[] };
  cuentas: CuentaContableOpcion[]; onClose: () => void; onSaved: () => void;
}) {
  const { recepcion, items } = data;
  const pendientes = items.filter((i) => n(i.cantidad_recibida) - n(i.cantidad_facturada) > 0);

  const [timbrado, setTimbrado] = useState("");
  const [tipoPago, setTipoPago] = useState<"contado" | "credito">("contado");
  const [plazo, setPlazo] = useState("");
  const [contrapartida, setContrapartida] = useState<string | null>(null);
  const [cant, setCant] = useState<Record<string, string>>(
    Object.fromEntries(pendientes.map((i) => [i.id, String(n(i.cantidad_recibida) - n(i.cantidad_facturada))]))
  );
  const [costo, setCosto] = useState<Record<string, string>>(
    Object.fromEntries(pendientes.map((i) => [i.id, String(Math.round(n(i.costo_unitario_recibido)))]))
  );
  const [ivas, setIvas] = useState<Record<string, IvaTipo>>(
    Object.fromEntries(pendientes.map((i) => [i.id, (["exenta", "5", "10"].includes(String(i.iva_tipo)) ? i.iva_tipo : "10") as IvaTipo]))
  );
  const [ctas, setCtas] = useState<Record<string, string | null>>(
    Object.fromEntries(pendientes.map((i) => [i.id, i.cuenta_contable_id ?? null]))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idem] = useState(uuid);

  const total = pendientes.reduce((s, i) => s + n(cant[i.id]) * n(costo[i.id]), 0);

  async function confirmar() {
    setError(null);
    const lineas = pendientes.filter((i) => n(cant[i.id]) > 0);
    if (lineas.length === 0) { setError("Cargá al menos una cantidad a facturar."); return; }
    if (!timbrado.trim()) { setError("Falta el N° de timbrado."); return; }
    if (lineas.some((i) => !ctas[i.id])) { setError("Cada línea necesita una cuenta contable."); return; }
    if (tipoPago === "contado" && !contrapartida) { setError("Elegí la cuenta de pago (Caja o Banco)."); return; }
    setBusy(true);
    try {
      const r = await apiFetch("/api/compras", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origen_compra: "recepcion",
          orden_compra_id: recepcion.orden_id,
          proveedor_id: recepcion.proveedor_id,
          proveedor_nombre: recepcion.proveedor_nombre ?? "",
          nro_timbrado: timbrado.trim(),
          tipo_pago: tipoPago,
          plazo_dias: tipoPago === "credito" ? plazo : null,
          cuenta_contrapartida_id: tipoPago === "contado" ? contrapartida : null,
          moneda: "PYG", tipo_cambio: 1, idempotency_key: idem,
          items: lineas.map((i) => ({
            producto_id: i.producto_id,
            producto_nombre: i.producto_nombre ?? "",
            descripcion: i.producto_nombre ?? "",
            cantidad: n(cant[i.id]),
            costo_unitario: n(costo[i.id]),
            iva_tipo: ivas[i.id],
            cuenta_contable_id: ctas[i.id],
            recepcion_item_id: i.id,
          })),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) { setError(j?.error ?? `Error ${r.status}`); return; }
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Error de red"); }
    finally { setBusy(false); }
  }

  return (
    <Overlay onClose={onClose} titulo={`Registrar factura de la recepción ${recepcion.numero}`}>
      <p className="text-xs text-slate-500">
        Esta compra <b>no vuelve a mover el stock</b> (ya entró con la recepción). Registra lo fiscal y contable:
        aparece en Libro de Compras, Libro Diario y Libro Mayor.
      </p>
      {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <label className="text-xs font-semibold text-slate-500">N° de timbrado *
          <input value={timbrado} onChange={(e) => setTimbrado(e.target.value.toUpperCase())} className={`mt-1 ${INPUT}`} /></label>
        <label className="text-xs font-semibold text-slate-500">Condición
          <select value={tipoPago} onChange={(e) => setTipoPago(e.target.value as "contado" | "credito")} className={`mt-1 ${INPUT}`}>
            <option value="contado">Contado</option><option value="credito">Crédito</option>
          </select></label>
        {tipoPago === "credito" ? (
          <label className="text-xs font-semibold text-slate-500">Plazo (días)
            <input inputMode="numeric" value={plazo} onChange={(e) => setPlazo(e.target.value)} className={`mt-1 ${INPUT}`} /></label>
        ) : (
          <div className="sm:col-span-2"><label className="text-xs font-semibold text-slate-500">Cuenta de pago *</label>
            <div className="mt-1"><CuentaCombobox cuentas={cuentas} value={contrapartida} onChange={setContrapartida}
              placeholder="(Caja o Banco)" /></div></div>
        )}
      </div>

      <div className="mt-4 space-y-3">
        {pendientes.length === 0 && <p className="text-sm text-slate-500">Esta recepción ya está totalmente facturada.</p>}
        {pendientes.map((i) => {
          const pend = n(i.cantidad_recibida) - n(i.cantidad_facturada);
          const dif = n(costo[i.id]) - n(i.costo_unitario_estimado);
          return (
            <div key={i.id} className="rounded-xl border border-slate-200 bg-slate-50/50 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-800">{i.producto_nombre ?? "Ítem"}</span>
                <span className="text-xs text-slate-500">
                  Recibido {fmt(i.cantidad_recibida)} · Ya facturado {fmt(i.cantidad_facturada)} ·{" "}
                  <b className="text-blue-700">Pendiente {fmt(pend)}</b>
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div><label className="text-xs font-semibold text-slate-500">Cuenta contable *</label>
                  <div className="mt-1"><CuentaCombobox cuentas={cuentas} value={ctas[i.id] ?? null}
                    onChange={(id) => setCtas((c) => ({ ...c, [i.id]: id }))} /></div></div>
                <div className="grid grid-cols-3 gap-2">
                  <label className="text-xs font-semibold text-slate-500">Cantidad
                    <input inputMode="decimal" value={cant[i.id] ?? ""}
                      onChange={(e) => setCant((c) => ({ ...c, [i.id]: e.target.value }))}
                      className={`mt-1 ${INPUT} text-right`} /></label>
                  <label className="text-xs font-semibold text-slate-500">Costo facturado
                    <input inputMode="decimal" value={costo[i.id] ?? ""}
                      onChange={(e) => setCosto((c) => ({ ...c, [i.id]: e.target.value }))}
                      className={`mt-1 ${INPUT} text-right`} /></label>
                  <label className="text-xs font-semibold text-slate-500">IVA
                    <select value={ivas[i.id]} onChange={(e) => setIvas((c) => ({ ...c, [i.id]: e.target.value as IvaTipo }))}
                      className={`mt-1 ${INPUT}`}>
                      <option value="10">10%</option><option value="5">5%</option><option value="exenta">Exenta</option>
                    </select></label>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-slate-500">
                <span>
                  Costo ordenado {fmt(i.costo_unitario_estimado ?? 0)} · recibido {fmt(i.costo_unitario_recibido)} · facturado {fmt(costo[i.id] ?? 0)}
                  {dif !== 0 && (
                    <b className={dif > 0 ? " text-red-600" : " text-emerald-700"}>
                      {" "}· diferencia {dif > 0 ? "+" : ""}{fmt(dif)} por unidad
                    </b>
                  )}
                </span>
                <span>Total línea (IVA incluido): <b className="text-slate-800">{fmt(n(cant[i.id]) * n(costo[i.id]))}</b></span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <span className="text-sm text-slate-600">Total de la factura: <b className="text-lg text-slate-900">{fmt(total)}</b></span>
        <div className="flex gap-2">
          <button onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancelar</button>
          <button onClick={confirmar} disabled={busy || pendientes.length === 0}
            className="rounded-xl bg-[#4FAEB2] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-60">
            {busy ? "Registrando…" : "Registrar compra / factura"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}
