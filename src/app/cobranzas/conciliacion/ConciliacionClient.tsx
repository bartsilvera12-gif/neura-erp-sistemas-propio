"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import SmartCombobox, { type ComboOption } from "@/components/ui/SmartCombobox";

interface Cobro {
  id: string; factura_id: string; monto: string | number; fecha: string; banco_origen: string;
  titular: string; numero_operacion: string; comprobante_path: string | null; estado: string;
  motivo_rechazo: string | null; numero_factura?: string | null; cliente_nombre?: string | null;
  saldo_factura?: string | number | null;
  aprobado_por_nombre?: string | null; aprobado_at?: string | null;
  rechazado_por_nombre?: string | null; rechazado_at?: string | null;
  anulado_por_nombre?: string | null; anulado_at?: string | null; motivo_anulacion?: string | null;
  creado_por_nombre?: string | null; vendedor_nombre?: string | null;
}
interface Factura { id: string; numero_factura: string; saldo: number; estado: string; cliente_id?: string | null }

interface AprobadoLite { id: string; monto: number; fecha: string; numero_operacion: string | null; banco_origen: string | null; titular: string | null; cliente_nombre: string | null; numero_factura: string | null; agrupadas?: number }
interface ExtractoTx { fecha: string | null; monto: number; tipo: string; referencia: string | null; descripcion: string | null }
interface Reporte {
  mes: string | null; archivo: string; moneda: string | null; banco_detectado: string | null; via?: string;
  conciliados: { aprobado: AprobadoLite; credito: ExtractoTx }[];
  montos_difieren: { aprobado: AprobadoLite; credito: ExtractoTx; diff: number }[];
  aprobados_sin_extracto: AprobadoLite[];
  extracto_sin_registrar: ExtractoTx[];
  resumen: { aprobados: number; creditos_extracto: number; conciliados: number; difieren: number; sin_extracto: number; sin_registrar: number; monto_conciliado: number; monto_sin_extracto: number; monto_sin_registrar: number };
}

const fmt = (v: number | string) => Math.round(Number(v) || 0).toLocaleString("es-PY");
const n = (v: string | number | null | undefined) => Number(v) || 0;
const hoy = () => new Date().toISOString().slice(0, 10);
const uuid = () => (globalThis.crypto?.randomUUID?.() ?? "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)));
const INPUT = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/40";
const ESTADO: Record<string, { label: string; cls: string }> = {
  pendiente: { label: "Pendiente", cls: "bg-amber-50 text-amber-700" },
  aprobado: { label: "Aprobado", cls: "bg-emerald-50 text-emerald-700" },
  rechazado: { label: "Rechazado", cls: "bg-red-50 text-red-700" },
  anulado: { label: "Anulado", cls: "bg-slate-100 text-slate-500 line-through" },
};

export default function ConciliacionClient() {
  const [cobros, setCobros] = useState<Cobro[]>([]);
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [filtro, setFiltro] = useState("pendiente");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [modal, setModal] = useState(false);

  // Conciliación asistida por IA: subir el PDF del extracto y cruzar contra las aprobadas del mes.
  const fileRef = useRef<HTMLInputElement>(null);
  const [analizando, setAnalizando] = useState(false);
  const [reporte, setReporte] = useState<Reporte | null>(null);
  const [analisisError, setAnalisisError] = useState<string | null>(null);
  // Modal propio para anular una aprobación (reemplaza el confirm/prompt del navegador).
  const [anularTarget, setAnularTarget] = useState<Cobro | null>(null);
  const [anularMotivo, setAnularMotivo] = useState("");
  const [anularBusy, setAnularBusy] = useState(false);
  // Animación de aprobación: spinner → check.
  const [aprobarAnim, setAprobarAnim] = useState<null | "loading" | "done">(null);

  // Selector de meses (filtra por fecha de la transferencia, del lado del cliente).
  const mesActual = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const [mes, setMes] = useState<string>(mesActual);
  const meses = useMemo(() => {
    const arr: { value: string; label: string }[] = [{ value: "", label: "Todos los meses" }];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const value = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
      const label = dt.toLocaleDateString("es-PY", { month: "long", year: "numeric" });
      arr.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) });
    }
    return arr;
  }, []);
  const [busqueda, setBusqueda] = useState("");
  const cobrosMostrados = useMemo(() => {
    let list = mes ? cobros.filter((c) => (c.fecha ?? "").slice(0, 7) === mes) : cobros;
    const q = busqueda.trim().toLowerCase();
    if (q) {
      list = list.filter((c) =>
        [c.cliente_nombre, c.banco_origen, c.titular, c.numero_operacion, c.numero_factura, String(c.monto)]
          .some((v) => String(v ?? "").toLowerCase().includes(q))
      );
    }
    return list;
  }, [cobros, mes, busqueda]);

  async function analizarExtracto(f: File) {
    setAnalizando(true); setAnalisisError(null); setReporte(null); setError(null); setOk(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      if (mes) fd.append("mes", mes);
      const r = await apiFetch("/api/cobranzas/conciliacion/analizar-extracto", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) { setAnalisisError(j?.error ?? `Error ${r.status}`); return; }
      setReporte(j.data as Reporte);
    } catch (e) {
      setAnalisisError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setAnalizando(false);
      // Resetear el input DESPUÉS de enviar (no antes): limpiarlo mientras el File aún no se
      // leyó anula sus bytes y el archivo llega vacío (bug del Excel). Así se puede re-subir el mismo.
      if (fileRef.current) fileRef.current.value = "";
    }
  }

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
    setError(null); setOk(null); setAnalisisError(null);
    let body: Record<string, unknown> = {};
    if (tipo === "rechazar") {
      const motivo = window.prompt("Motivo del rechazo:");
      if (!motivo?.trim()) { setError("Se requiere un motivo para rechazar."); return; }
      body = { motivo };
    }
    if (tipo === "aprobar") setAprobarAnim("loading");
    let r: Response;
    try {
      r = await apiFetch(`/api/cobranzas/conciliacion/${id}/${tipo}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
    } catch (e) {
      setAprobarAnim(null);
      setError(e instanceof Error ? e.message : "Error de red");
      return;
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) { setAprobarAnim(null); setError(j?.error ?? `Error ${r.status}`); return; }
    if (tipo === "aprobar") {
      setOk(j.data?.es_anticipo
        ? "Aprobada. La factura aún no tiene DTE aprobado → se registró como Anticipo de Clientes."
        : "Aprobada y contabilizada (Debe Banco / Haber Clientes).");
      // Spinner → check, y cierra solo.
      setAprobarAnim("done");
      window.setTimeout(() => setAprobarAnim(null), 1200);
    } else setOk("Transferencia rechazada.");
    cargar();
  }

  async function doAnular() {
    if (!anularTarget) return;
    if (!anularMotivo.trim()) { setError("Se requiere un motivo para anular."); return; }
    setAnularBusy(true); setError(null); setOk(null); setAnalisisError(null);
    try {
      const r = await apiFetch(`/api/cobranzas/conciliacion/${anularTarget.id}/anular`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ motivo: anularMotivo.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) { setError(j?.error ?? `Error ${r.status}`); return; }
      setOk("Transferencia anulada: asiento revertido y saldo de la factura restaurado.");
      setAnularTarget(null); setAnularMotivo("");
      cargar();
    } finally {
      setAnularBusy(false);
    }
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
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <input ref={fileRef} type="file" accept=".pdf,.xlsx,.xls,.csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) analizarExtracto(f); }} />
          <button onClick={() => fileRef.current?.click()} disabled={analizando}
            title="Subí tu extracto (PDF o Excel) y verificá las aprobaciones del mes contra el banco"
            className="rounded-xl border border-[#4FAEB2] bg-white px-3.5 py-2 text-sm font-semibold text-[#3F8E91] shadow-sm transition-colors hover:bg-[#4FAEB2]/8 disabled:opacity-60">
            {analizando ? "Analizando…" : "📄 Cargar extracto (PDF o Excel)"}
          </button>
          <button onClick={() => setModal(true)} className="rounded-xl bg-[#4FAEB2] px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#3F8E91]">+ Registrar transferencia</button>
        </div>
      </div>

      {analisisError && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{analisisError}</div>}
      {analizando && (
        <div className="flex items-center gap-3 rounded-lg border border-[#4FAEB2]/30 bg-[#4FAEB2]/5 p-3 text-sm text-[#3F8E91]">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#4FAEB2]" />
          Analizando el extracto con IA y cruzando contra las transferencias aprobadas{mes ? ` de ${mes}` : ""}…
        </div>
      )}

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {ok && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{ok}</div>}

      <div className="flex flex-wrap items-center gap-2">
        {["pendiente", "aprobado", "rechazado", "anulado", ""].map((e) => (
          <button key={e || "todas"} onClick={() => setFiltro(e)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${filtro === e ? "bg-[#4FAEB2] text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
            {e ? ESTADO[e].label : "Todas"}
          </button>
        ))}
        <input
          type="search"
          value={busqueda}
          onChange={(ev) => setBusqueda(ev.target.value)}
          placeholder="🔍 Buscar cliente, banco, titular, N° op, factura o monto…"
          aria-label="Buscar transferencias"
          className="ml-2 w-72 max-w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/40"
        />
        <select
          value={mes}
          onChange={(ev) => setMes(ev.target.value)}
          aria-label="Filtrar por mes"
          className="ml-auto rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/40"
        >
          {meses.map((m) => (
            <option key={m.value || "all"} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[1080px] text-sm">
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
              <th className="px-3 py-2.5 text-left">Aprobó / Rechazó</th>
              <th className="px-3 py-2.5 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400">Cargando…</td></tr>
            ) : cobrosMostrados.length === 0 ? (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400">{busqueda.trim() ? "Sin resultados para la búsqueda." : `Sin transferencias${mes ? " en el mes seleccionado" : ""}.`}</td></tr>
            ) : cobrosMostrados.map((c) => {
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
                    {c.estado === "anulado" && c.motivo_anulacion && <span className="mt-0.5 block text-[10px] italic text-slate-400">{c.motivo_anulacion}</span>}
                  </td>
                  <td className="px-3 py-2">
                    {c.estado === "aprobado" && c.aprobado_por_nombre ? (
                      <div>
                        <span className="text-slate-700">{c.aprobado_por_nombre}</span>
                        {c.aprobado_at && <span className="block text-[10px] text-slate-400">{new Date(c.aprobado_at).toLocaleString("es-PY", { dateStyle: "short", timeStyle: "short" })}</span>}
                      </div>
                    ) : c.estado === "rechazado" && c.rechazado_por_nombre ? (
                      <div>
                        <span className="text-slate-700">{c.rechazado_por_nombre}</span>
                        {c.rechazado_at && <span className="block text-[10px] text-slate-400">{new Date(c.rechazado_at).toLocaleString("es-PY", { dateStyle: "short", timeStyle: "short" })}</span>}
                      </div>
                    ) : c.estado === "anulado" && c.anulado_por_nombre ? (
                      <div>
                        <span className="text-slate-700">Anuló: {c.anulado_por_nombre}</span>
                        {c.anulado_at && <span className="block text-[10px] text-slate-400">{new Date(c.anulado_at).toLocaleString("es-PY", { dateStyle: "short", timeStyle: "short" })}</span>}
                      </div>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
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
                      {c.estado === "aprobado" && (
                        <button onClick={() => { setAnularTarget(c); setAnularMotivo(""); }} title="Anular la aprobación (revierte el asiento y restaura el saldo)" className="rounded border border-red-200 px-2 py-1 font-semibold text-red-600 hover:bg-red-50">Anular</button>
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

      {anularTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !anularBusy && setAnularTarget(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 border-b p-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Anular transferencia aprobada</h3>
                <p className="text-xs text-slate-500">Revierte el asiento contable y restaura el saldo de la factura. Queda auditado.</p>
              </div>
              <button onClick={() => setAnularTarget(null)} disabled={anularBusy} className="shrink-0 text-lg text-slate-400 hover:text-slate-600 disabled:opacity-50">✕</button>
            </div>
            <div className="space-y-3 p-4">
              <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
                <dt className="text-slate-400">Cliente</dt>
                <dd className="col-span-2 font-medium text-slate-800">{anularTarget.cliente_nombre ?? "—"}</dd>
                <dt className="text-slate-400">Vendedor</dt>
                <dd className="col-span-2 text-slate-700">{anularTarget.vendedor_nombre ?? "—"}</dd>
                <dt className="text-slate-400">Cargó el pago</dt>
                <dd className="col-span-2 text-slate-700">{anularTarget.creado_por_nombre ?? "—"}</dd>
                <dt className="text-slate-400">Factura</dt>
                <dd className="col-span-2 font-mono text-xs text-slate-700">{anularTarget.numero_factura ?? "—"}</dd>
                <dt className="text-slate-400">Banco / Titular</dt>
                <dd className="col-span-2 text-slate-700">{anularTarget.banco_origen} · {anularTarget.titular}</dd>
                <dt className="text-slate-400">N° operación</dt>
                <dd className="col-span-2 font-mono text-xs text-slate-700">{anularTarget.numero_operacion}</dd>
                <dt className="text-slate-400">Monto</dt>
                <dd className="col-span-2 text-base font-semibold tabular-nums text-slate-900">₲ {fmt(anularTarget.monto)}</dd>
              </dl>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Motivo de la anulación <span className="text-red-500">*</span></label>
                <textarea value={anularMotivo} onChange={(e) => setAnularMotivo(e.target.value)} rows={2} autoFocus
                  placeholder="Ej: aprobación duplicada / monto incorrecto…"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t p-4">
              <button onClick={() => setAnularTarget(null)} disabled={anularBusy} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
              <button onClick={doAnular} disabled={anularBusy || !anularMotivo.trim()} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-50">
                {anularBusy ? "Anulando…" : "Anular y revertir"}
              </button>
            </div>
          </div>
        </div>
      )}

      {aprobarAnim && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/25">
          <div className="cb-aprob-card flex w-44 flex-col items-center gap-3 rounded-2xl bg-white px-6 py-7 shadow-xl">
            {aprobarAnim === "loading" ? (
              <span className="cb-spinner" />
            ) : (
              <svg viewBox="0 0 56 56" className="cb-check" aria-hidden>
                <circle className="cb-check-circle" cx="28" cy="28" r="26" />
                <path className="cb-check-mark" d="M16 29 l8 8 l16 -17" />
              </svg>
            )}
            <p className="text-sm font-semibold text-slate-700">{aprobarAnim === "loading" ? "Aprobando…" : "¡Aprobado!"}</p>
          </div>
          <style>{`
            .cb-aprob-card { animation: cbPop .18s ease-out; }
            @keyframes cbPop { from { transform: scale(.9); opacity: 0 } to { transform: scale(1); opacity: 1 } }
            .cb-spinner { display:block; width:56px; height:56px; border-radius:9999px; border:5px solid rgba(79,174,178,.22); border-top-color:#4FAEB2; animation: cbSpin .7s linear infinite; }
            @keyframes cbSpin { to { transform: rotate(360deg) } }
            .cb-check { width:56px; height:56px; }
            .cb-check-circle { fill:#22c55e; transform-box: fill-box; transform-origin: center; animation: cbPunch .45s cubic-bezier(.65,0,.45,1); }
            .cb-check-mark { fill:none; stroke:#fff; stroke-width:5; stroke-linecap:round; stroke-linejoin:round; stroke-dasharray:46; stroke-dashoffset:46; animation: cbDraw .4s .14s ease-out forwards; }
            @keyframes cbPunch { 0%{transform:scale(.5)} 60%{transform:scale(1.12)} 100%{transform:scale(1)} }
            @keyframes cbDraw { to { stroke-dashoffset:0 } }
          `}</style>
        </div>
      )}

      {reporte && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => setReporte(null)}>
          <div className="my-6 w-full max-w-3xl rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 border-b p-4">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-slate-900">Conciliación del extracto</h3>
                <p className="truncate text-xs text-slate-500">
                  {reporte.archivo}{reporte.banco_detectado ? ` · ${reporte.banco_detectado}` : ""}{reporte.mes ? ` · ${reporte.mes}` : ""}
                  {reporte.via === "excel-directo" ? " · Excel (lectura directa)" : reporte.via === "excel-ia" ? " · Excel (IA)" : reporte.via === "pdf-ia" ? " · PDF (IA)" : ""}
                </p>
              </div>
              <button onClick={() => setReporte(null)} className="shrink-0 text-lg text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { l: "Aprobadas", v: reporte.resumen.aprobados, cls: "text-slate-900" },
                  { l: "Conciliadas", v: reporte.resumen.conciliados, cls: "text-emerald-700" },
                  { l: "Sin respaldo", v: reporte.resumen.sin_extracto, cls: "text-red-700" },
                  { l: "No registradas", v: reporte.resumen.sin_registrar, cls: "text-amber-700" },
                ].map((c) => (
                  <div key={c.l} className="rounded-xl border border-slate-200 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">{c.l}</p>
                    <p className={`text-2xl font-semibold tabular-nums ${c.cls}`}>{c.v}</p>
                  </div>
                ))}
              </div>

              {reporte.resumen.sin_extracto === 0 && reporte.resumen.difieren === 0 ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                  ✅ Todas las transferencias aprobadas tienen respaldo en el extracto.
                </div>
              ) : (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  ⚠️ {reporte.resumen.sin_extracto} aprobada(s) sin respaldo y {reporte.resumen.difieren} con monto distinto. Revisá abajo.
                </div>
              )}

              {reporte.aprobados_sin_extracto.length > 0 && (
                <section>
                  <h4 className="mb-1.5 text-sm font-semibold text-red-700">🔴 Aprobadas sin respaldo en el extracto · {fmt(reporte.resumen.monto_sin_extracto)}</h4>
                  <div className="overflow-hidden rounded-lg border border-red-100">
                    {reporte.aprobados_sin_extracto.map((a) => (
                      <div key={a.id} className="flex items-center justify-between gap-2 border-b border-red-50 px-3 py-2 text-sm last:border-0">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-800">{a.cliente_nombre ?? a.titular ?? "—"}</p>
                          <p className="text-[11px] text-slate-500">{a.fecha} · {a.banco_origen ?? "—"} · Op {a.numero_operacion ?? "—"}{a.numero_factura ? ` · ${a.numero_factura}` : ""}{a.agrupadas && a.agrupadas > 1 ? ` · ${a.agrupadas} cobros agrupados` : ""}</p>
                        </div>
                        <span className="shrink-0 font-semibold tabular-nums text-red-700">{fmt(a.monto)}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {reporte.montos_difieren.length > 0 && (
                <section>
                  <h4 className="mb-1.5 text-sm font-semibold text-amber-700">⚠️ Montos que no coinciden</h4>
                  <div className="overflow-hidden rounded-lg border border-amber-100">
                    {reporte.montos_difieren.map((p, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 border-b border-amber-50 px-3 py-2 text-sm last:border-0">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-800">{p.aprobado.cliente_nombre ?? p.aprobado.titular ?? "—"}</p>
                          <p className="text-[11px] text-slate-500">Op {p.aprobado.numero_operacion ?? "—"} · {p.aprobado.fecha}</p>
                        </div>
                        <span className="shrink-0 text-right text-[13px] tabular-nums">
                          <span className="text-slate-700">Sist: {fmt(p.aprobado.monto)}</span>
                          <span className="block text-amber-700">Banco: {fmt(p.credito.monto)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {reporte.extracto_sin_registrar.length > 0 && (
                <section>
                  <h4 className="mb-1.5 text-sm font-semibold text-amber-700">🟡 Ingresos del extracto no registrados en el sistema · {fmt(reporte.resumen.monto_sin_registrar)}</h4>
                  <div className="overflow-hidden rounded-lg border border-amber-100">
                    {reporte.extracto_sin_registrar.map((c, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 border-b border-amber-50 px-3 py-2 text-sm last:border-0">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-800">{c.descripcion ?? "Ingreso"}</p>
                          <p className="text-[11px] text-slate-500">{c.fecha ?? "—"} · Ref {c.referencia ?? "—"}</p>
                        </div>
                        <span className="shrink-0 font-semibold tabular-nums text-amber-700">{fmt(c.monto)}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {reporte.conciliados.length > 0 && (
                <p className="text-xs text-emerald-700">✅ {reporte.conciliados.length} transferencia(s) conciliada(s) por {fmt(reporte.resumen.monto_conciliado)}.</p>
              )}
              <p className="text-[11px] text-slate-400">El extracto se procesó con IA (Claude) y no modifica nada: es una verificación. Revisá los casos marcados.</p>
            </div>
          </div>
        </div>
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
