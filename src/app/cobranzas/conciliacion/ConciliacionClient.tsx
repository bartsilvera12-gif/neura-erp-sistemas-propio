"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import SmartCombobox, { type ComboOption } from "@/components/ui/SmartCombobox";

interface Cobro {
  id: string; factura_id: string; monto: string | number; fecha: string; banco_origen: string;
  titular: string; numero_operacion: string; comprobante_path: string | null; estado: string;
  motivo_rechazo: string | null; numero_factura?: string | null; cliente_nombre?: string | null;
  saldo_factura?: string | number | null;
}
interface Factura { id: string; numero_factura: string; saldo: number; estado: string; cliente_id?: string | null }

const fmt = (v: number | string) => Math.round(Number(v) || 0).toLocaleString("es-PY");
const n = (v: string | number | null | undefined) => Number(v) || 0;
const hoy = () => new Date().toISOString().slice(0, 10);
const uuid = () => (globalThis.crypto?.randomUUID?.() ?? "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)));
const INPUT = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/40";
const ESTADO: Record<string, { label: string; cls: string }> = {
  pendiente: { label: "Pendiente", cls: "bg-amber-50 text-amber-700" },
  aprobado: { label: "Aprobado", cls: "bg-emerald-50 text-emerald-700" },
  rechazado: { label: "Rechazado", cls: "bg-red-50 text-red-700" },
};

export default function ConciliacionClient() {
  const [cobros, setCobros] = useState<Cobro[]>([]);
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [filtro, setFiltro] = useState("pendiente");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [modal, setModal] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const p = new URLSearchParams();
      if (filtro) p.set("estado", filtro);
      const r = await apiFetch(`/api/cobranzas/conciliacion?${p.toString()}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) { setError(j?.error ?? `Error ${r.status}`); setCobros([]); return; }
      setCobros(j.data.cobros as Cobro[]);
    } catch (e) { setError(e instanceof Error ? e.message : "Error de red"); }
    finally { setLoading(false); }
  }, [filtro]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    apiFetch("/api/facturas").then(async (r) => {
      const j = await r.json().catch(() => ({}));
      const list = (Array.isArray(j?.data) ? j.data : []) as Factura[];
      setFacturas(list.filter((f) => n(f.saldo) > 0 && !["Anulado", "Corregida NC"].includes(f.estado)));
    }).catch(() => {});
  }, [modal]);

  async function accion(id: string, tipo: "aprobar" | "rechazar") {
    setError(null); setOk(null);
    let body: Record<string, unknown> = {};
    if (tipo === "rechazar") {
      const motivo = window.prompt("Motivo del rechazo:");
      if (!motivo?.trim()) { setError("Se requiere un motivo para rechazar."); return; }
      body = { motivo };
    }
    const r = await apiFetch(`/api/cobranzas/conciliacion/${id}/${tipo}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) { setError(j?.error ?? `Error ${r.status}`); return; }
    if (tipo === "aprobar") {
      setOk(j.data?.es_anticipo
        ? "Aprobada. La factura aún no tiene DTE aprobado → se registró como Anticipo de Clientes."
        : "Aprobada y contabilizada (Debe Banco / Haber Clientes).");
    } else setOk("Transferencia rechazada.");
    cargar();
  }

  async function verComprobante(id: string) {
    const r = await apiFetch(`/api/cobranzas/conciliacion/${id}/comprobante`);
    const j = await r.json().catch(() => ({}));
    if (j?.data?.comprobante_url) window.open(j.data.comprobante_url, "_blank", "noopener");
    else setError("No hay comprobante o no se pudo abrir.");
  }

  return (
    <div className="w-full min-w-0 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-[#4FAEB2] shadow-[0_0_0_3px_rgba(79,174,178,0.18)]" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">Finanzas · Cobranzas</p>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Conciliación bancaria</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">Transferencias pendientes de aprobar. Pendiente no reduce saldo ni contabiliza; al aprobar nace el pago, baja el saldo y se genera el asiento (Debe Banco / Haber Clientes o Anticipos).</p>
        </div>
        <button onClick={() => setModal(true)} className="shrink-0 rounded-xl bg-[#4FAEB2] px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#3F8E91]">+ Registrar transferencia</button>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {ok && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{ok}</div>}

      <div className="flex items-center gap-2">
        {["pendiente", "aprobado", "rechazado", ""].map((e) => (
          <button key={e || "todas"} onClick={() => setFiltro(e)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${filtro === e ? "bg-[#4FAEB2] text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
            {e ? ESTADO[e].label : "Todas"}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="border-b bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2.5 text-left">Fecha</th>
              <th className="px-3 py-2.5 text-left">Factura</th>
              <th className="px-3 py-2.5 text-left">Cliente</th>
              <th className="px-3 py-2.5 text-left">Banco origen</th>
              <th className="px-3 py-2.5 text-left">Titular</th>
              <th className="px-3 py-2.5 text-left">N° operación</th>
              <th className="px-3 py-2.5 text-right">Monto</th>
              <th className="px-3 py-2.5 text-center">Estado</th>
              <th className="px-3 py-2.5 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">Cargando…</td></tr>
            ) : cobros.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">Sin transferencias.</td></tr>
            ) : cobros.map((c) => {
              const e = ESTADO[c.estado] ?? { label: c.estado, cls: "bg-slate-100 text-slate-600" };
              return (
                <tr key={c.id} className="border-b last:border-0 hover:bg-slate-50/60">
                  <td className="px-3 py-2">{(c.fecha ?? "").slice(0, 10)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{c.numero_factura ?? "—"}</td>
                  <td className="px-3 py-2">{c.cliente_nombre ?? "—"}</td>
                  <td className="px-3 py-2">{c.banco_origen}</td>
                  <td className="px-3 py-2">{c.titular}</td>
                  <td className="px-3 py-2 font-mono text-xs">{c.numero_operacion}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt(c.monto)}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${e.cls}`}>{e.label}</span>
                    {c.estado === "rechazado" && c.motivo_rechazo && <span className="mt-0.5 block text-[10px] italic text-slate-400">{c.motivo_rechazo}</span>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1.5 text-xs">
                      {c.comprobante_path && <button onClick={() => verComprobante(c.id)} className="rounded px-2 py-1 text-[#3F8E91] hover:bg-slate-100">📎 Ver</button>}
                      {c.estado === "pendiente" && (
                        <>
                          <button onClick={() => accion(c.id, "aprobar")} className="rounded bg-emerald-600 px-2 py-1 font-semibold text-white hover:bg-emerald-700">Aprobar</button>
                          <button onClick={() => accion(c.id, "rechazar")} className="rounded px-2 py-1 text-red-600 hover:bg-red-50">Rechazar</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modal && (
        <ModalRegistrar facturas={facturas} onClose={() => setModal(false)}
          onSaved={(msg) => { setModal(false); setOk(msg); cargar(); }} />
      )}
    </div>
  );
}

function ModalRegistrar({ facturas, onClose, onSaved }: { facturas: Factura[]; onClose: () => void; onSaved: (msg: string) => void }) {
  const [facturaId, setFacturaId] = useState<string | null>(null);
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState(hoy());
  const [banco, setBanco] = useState("");
  const [titular, setTitular] = useState("");
  const [numeroOp, setNumeroOp] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idem] = useState(uuid);
  const fileRef = useRef<HTMLInputElement>(null);

  const opts: ComboOption[] = useMemo(() => facturas.map((f) => ({ id: f.id, label: f.numero_factura, sub: `saldo ₲ ${fmt(f.saldo)}` })), [facturas]);
  const facturaSel = facturas.find((f) => f.id === facturaId);

  async function guardar() {
    setError(null);
    if (!facturaId) { setError("Elegí la factura."); return; }
    if (!(n(monto) > 0)) { setError("El monto debe ser mayor a 0."); return; }
    if (facturaSel && n(monto) > n(facturaSel.saldo)) { setError(`El monto supera el saldo de la factura (₲ ${fmt(facturaSel.saldo)}).`); return; }
    if (!banco.trim() || !titular.trim() || !numeroOp.trim()) { setError("Banco, titular y número de operación son obligatorios."); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("factura_id", facturaId);
      fd.append("monto", String(n(monto)));
      fd.append("fecha", fecha);
      fd.append("banco_origen", banco.trim());
      fd.append("titular", titular.trim());
      fd.append("numero_operacion", numeroOp.trim());
      fd.append("idempotency_key", idem);
      if (archivo) fd.append("file", archivo);
      const r = await apiFetch("/api/cobranzas/conciliacion", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) { setError(j?.error ?? `Error ${r.status}`); return; }
      onSaved(j.data?.warning ?? "Transferencia registrada. Queda pendiente de aprobación.");
    } catch (e) { setError(e instanceof Error ? e.message : "Error de red"); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center bg-slate-900/60 px-0 pt-0 backdrop-blur-sm sm:px-4 sm:pt-16" onClick={onClose}>
      <div className="w-full max-w-lg rounded-none border-0 bg-white p-5 shadow-2xl sm:rounded-2xl sm:border" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Registrar transferencia</h2>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">✕</button>
        </div>
        {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        <div className="space-y-3">
          <div><label className="mb-1 block text-xs font-semibold text-slate-500">Factura *</label>
            <SmartCombobox options={opts} value={facturaId} onChange={setFacturaId} placeholder="Elegir factura con saldo…" />
            {facturaSel && <p className="mt-1 text-[11px] text-slate-400">Saldo actual: ₲ {fmt(facturaSel.saldo)}</p>}</div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="mb-1 block text-xs font-semibold text-slate-500">Monto *</label>
              <input inputMode="numeric" value={monto} onChange={(e) => setMonto(e.target.value.replace(/\D/g, ""))} placeholder="Ej: 500000" className={`${INPUT} text-right`} /></div>
            <div><label className="mb-1 block text-xs font-semibold text-slate-500">Fecha *</label>
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={INPUT} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="mb-1 block text-xs font-semibold text-slate-500">Banco de origen *</label>
              <input value={banco} onChange={(e) => setBanco(e.target.value)} placeholder="Ej: Itaú" className={INPUT} /></div>
            <div><label className="mb-1 block text-xs font-semibold text-slate-500">Titular *</label>
              <input value={titular} onChange={(e) => setTitular(e.target.value)} placeholder="Nombre del titular" className={INPUT} /></div>
          </div>
          <div><label className="mb-1 block text-xs font-semibold text-slate-500">N° de operación *</label>
            <input value={numeroOp} onChange={(e) => setNumeroOp(e.target.value)} placeholder="Comprobante / nro de transacción" className={INPUT} /></div>
          <div><label className="mb-1 block text-xs font-semibold text-slate-500">Comprobante (opcional)</label>
            {!archivo ? (
              <button type="button" onClick={() => fileRef.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-3 text-sm font-semibold text-[#3F8E91] hover:bg-[#4FAEB2]/5">📎 Adjuntar imagen o PDF</button>
            ) : (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
                <span className="truncate text-slate-700">📄 {archivo.name}</span>
                <button type="button" onClick={() => { setArchivo(null); if (fileRef.current) fileRef.current.value = ""; }} className="shrink-0 rounded px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">Quitar</button>
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
            <p className="mt-1 text-[11px] text-slate-400">JPG, PNG, WebP o PDF · máx. 8 MB.</p>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancelar</button>
          <button onClick={guardar} disabled={busy} className="rounded-xl bg-[#4FAEB2] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-60">{busy ? "Registrando…" : "Registrar (queda pendiente)"}</button>
        </div>
      </div>
    </div>
  );
}
