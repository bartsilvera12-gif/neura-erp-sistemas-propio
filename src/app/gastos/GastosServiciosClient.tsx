"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getGastos, type Gasto } from "@/lib/gastos/actions";
import { getCuentasContablesOpciones, type CuentaContableOpcion } from "@/lib/compras/storage";
import { getProveedores } from "@/lib/proveedores/storage";
import type { Proveedor } from "@/lib/proveedores/types";
import {
  crearBorrador, editarBorrador, eliminarBorrador, confirmarGasto, anularGasto,
  completarHistorico, getGastoDetalle,
  type GastoHeaderForm, type GastoItemForm, type IvaTipo, type GastoEstado,
} from "@/lib/gastos/servicios-client";

const IVA_RATE: Record<IvaTipo, number> = { exenta: 0, "5": 0.05, "10": 0.1 };
const TIPO_COMPROBANTES = ["Factura", "Factura Electrónica", "Factura Virtual", "Factura de Exportación", "Autofactura", "Boleta", "Nota de Crédito", "Nota de Débito", "Recibo", "Otro"];
const fmt = (n: number) => `₲ ${Math.round(n).toLocaleString("es-PY")}`;

const ESTADO_BADGE: Record<GastoEstado, string> = {
  borrador: "bg-slate-100 text-slate-600",
  confirmado: "bg-emerald-50 text-emerald-700",
  anulado: "bg-red-50 text-red-600",
  historico: "bg-amber-50 text-amber-700",
};

/** Formatea el número de comprobante con guiones automáticos: 3-3-7 (001-001-0000001). */
function formatComprobante(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 13);
  let out = d.slice(0, 3);
  if (d.length > 3) out += "-" + d.slice(3, 6);
  if (d.length > 6) out += "-" + d.slice(6, 13);
  return out;
}

function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Mode = "nuevo" | "editar" | "completar";

export default function GastosServiciosClient() {
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtroEstado, setFiltroEstado] = useState<string>("");
  const [busqueda, setBusqueda] = useState("");
  const [desde, setDesde] = useState<string>(firstOfMonth());
  const [hasta, setHasta] = useState<string>(today());

  const [cuentas, setCuentas] = useState<CuentaContableOpcion[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("nuevo");
  const [editId, setEditId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setGastos(await getGastos());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    getCuentasContablesOpciones().then(setCuentas);
    getProveedores().then((p) => setProveedores(p.filter((x) => x.estado === "activo")));
  }, [load]);

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return gastos.filter((g) => {
      if (filtroEstado && (g.estado ?? "") !== filtroEstado) return false;
      const fechaG = (g.fecha_comprobante ?? g.fecha ?? "").slice(0, 10);
      if (desde && fechaG && fechaG < desde) return false;
      if (hasta && fechaG && fechaG > hasta) return false;
      if (!q) return true;
      return (
        (g.numero ?? "").toLowerCase().includes(q) ||
        (g.proveedor_nombre ?? "").toLowerCase().includes(q) ||
        (g.descripcion ?? "").toLowerCase().includes(q) ||
        (g.numero_comprobante ?? "").toLowerCase().includes(q)
      );
    });
  }, [gastos, filtroEstado, busqueda, desde, hasta]);

  const resumen = useMemo(() => {
    const by = (e: GastoEstado) => gastos.filter((g) => g.estado === e).length;
    return { total: gastos.length, borrador: by("borrador"), confirmado: by("confirmado"), anulado: by("anulado"), historico: by("historico") };
  }, [gastos]);

  function abrirNuevo() { setMode("nuevo"); setEditId(null); setFormOpen(true); }
  function abrirEditar(id: string) { setMode("editar"); setEditId(id); setFormOpen(true); }
  function abrirCompletar(id: string) { setMode("completar"); setEditId(id); setFormOpen(true); }

  async function accionConfirmar(g: Gasto) {
    setError(null);
    const r = await confirmarGasto(g.id);
    if (!r.ok) { setError(r.error); return; }
    await load();
  }
  async function accionEliminar(g: Gasto) {
    if (!window.confirm(`¿Eliminar el borrador? Esta acción no se puede deshacer.`)) return;
    setError(null);
    const r = await eliminarBorrador(g.id);
    if (!r.ok) { setError(r.error); return; }
    await load();
  }
  async function accionAnular(g: Gasto) {
    const motivo = window.prompt("Motivo de anulación (mín. 3 caracteres):") ?? "";
    if (motivo.trim().length < 3) { if (motivo !== "") setError("Motivo inválido."); return; }
    setError(null);
    const r = await anularGasto(g.id, motivo.trim());
    if (!r.ok) { setError(r.error); return; }
    await load();
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-[#4FAEB2] shadow-[0_0_0_3px_rgba(79,174,178,0.18)]" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">Finanzas · Gastos y Servicios</p>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Gastos y Servicios</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">Documentos que no afectan inventario (servicios, alquiler, honorarios, etc.) con datos fiscales y contables.</p>
        </div>
        <button onClick={abrirNuevo} className="shrink-0 rounded-xl bg-[#4FAEB2] px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#3F8E91]">+ Nuevo gasto o servicio</button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { l: "Total", v: resumen.total },
          { l: "Borradores", v: resumen.borrador },
          { l: "Confirmados", v: resumen.confirmado },
          { l: "Anulados", v: resumen.anulado },
          { l: "Históricos", v: resumen.historico },
        ].map((k) => (
          <div key={k.l} className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
            <p className="text-xs text-slate-400">{k.l}</p>
            <p className="text-lg font-bold tabular-nums text-slate-800">{k.v}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por número, proveedor, comprobante…"
          className="min-w-[16rem] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/40" />
        <label className="flex items-center gap-1 text-xs text-slate-500">Desde
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-500">Hasta
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
        </label>
        {(desde || hasta) && (
          <button onClick={() => { setDesde(""); setHasta(""); }} className="text-xs font-semibold text-[#3F8E91] underline-offset-2 hover:underline">Todas las fechas</button>
        )}
        <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-2 text-sm">
          <option value="">Todos los estados</option>
          <option value="borrador">Borradores</option>
          <option value="confirmado">Confirmados</option>
          <option value="anulado">Anulados</option>
          <option value="historico">Históricos pendientes</option>
        </select>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="border-b bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2.5 text-left">Número</th>
              <th className="px-3 py-2.5 text-left">Proveedor</th>
              <th className="px-3 py-2.5 text-left">Comprobante</th>
              <th className="px-3 py-2.5 text-left">Fecha</th>
              <th className="px-3 py-2.5 text-right">Total</th>
              <th className="px-3 py-2.5 text-center">Estado</th>
              <th className="px-3 py-2.5 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">Cargando…</td></tr>
            ) : filtradas.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">No hay gastos o servicios que coincidan.</td></tr>
            ) : filtradas.map((g) => (
              <tr key={g.id} className={`border-b last:border-0 hover:bg-slate-50/60 ${g.estado === "anulado" ? "opacity-60" : ""}`}>
                <td className="px-3 py-2 font-mono text-xs text-slate-600">{g.numero ?? "—"}</td>
                <td className="px-3 py-2 text-slate-800">{g.proveedor_nombre ?? <span className="italic text-slate-400">Sin proveedor</span>}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{[g.tipo_comprobante, g.numero_comprobante].filter(Boolean).join(" ") || "—"}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{(g.fecha_comprobante ?? g.fecha ?? "").slice(0, 10) || "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-800">{fmt(g.total ?? g.monto ?? 0)}</td>
                <td className="px-3 py-2 text-center">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_BADGE[(g.estado ?? "historico") as GastoEstado]}`}>
                    {g.estado ?? "—"}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1.5 text-xs">
                    {g.estado === "borrador" && (
                      <>
                        <button onClick={() => abrirEditar(g.id)} className="rounded px-2 py-1 text-[#3F8E91] hover:bg-slate-100">Editar</button>
                        <button onClick={() => accionConfirmar(g)} className="rounded bg-emerald-600 px-2 py-1 font-semibold text-white hover:bg-emerald-700">Confirmar</button>
                        <button onClick={() => accionEliminar(g)} className="rounded px-2 py-1 text-red-600 hover:bg-red-50">Eliminar</button>
                      </>
                    )}
                    {g.estado === "confirmado" && (
                      <button onClick={() => accionAnular(g)} className="rounded px-2 py-1 text-red-600 hover:bg-red-50">Anular</button>
                    )}
                    {g.estado === "historico" && (
                      <button onClick={() => abrirCompletar(g.id)} className="rounded bg-amber-500 px-2 py-1 font-semibold text-white hover:bg-amber-600">Completar</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {formOpen && (
        <GastoFormModal
          mode={mode}
          gastoId={editId}
          cuentas={cuentas}
          proveedores={proveedores}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); load(); }}
        />
      )}
    </div>
  );
}

function emptyItem(): GastoItemForm {
  return { descripcion: "", cuenta_contable_id: null, subtotal: 0, iva_tipo: "10" };
}

function GastoFormModal({
  mode, gastoId, cuentas, proveedores, onClose, onSaved,
}: {
  mode: Mode;
  gastoId: string | null;
  cuentas: CuentaContableOpcion[];
  proveedores: Proveedor[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<GastoHeaderForm>({
    proveedor_id: null, descripcion: null, tipo_comprobante: "Factura", numero_comprobante: null,
    timbrado: null, fecha_comprobante: null, fecha_contable: null, tipo_pago: "contado",
    plazo_dias: null, fecha_vencimiento: null, moneda: "PYG", items: [emptyItem()],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingDetalle, setLoadingDetalle] = useState(mode !== "nuevo");

  useEffect(() => {
    if (mode === "nuevo" || !gastoId) return;
    getGastoDetalle(gastoId).then((r) => {
      if (!r.ok) { setError(r.error); setLoadingDetalle(false); return; }
      const h = r.data.header;
      setForm({
        proveedor_id: h.proveedor_id ?? null,
        descripcion: h.descripcion ?? null,
        tipo_comprobante: h.tipo_comprobante ?? "Factura",
        numero_comprobante: h.numero_comprobante ?? null,
        timbrado: h.timbrado ?? null,
        fecha_comprobante: h.fecha_comprobante ? String(h.fecha_comprobante).slice(0, 10) : null,
        fecha_contable: h.fecha_contable ? String(h.fecha_contable).slice(0, 10) : null,
        tipo_pago: (h.tipo_pago as "contado" | "credito") ?? "contado",
        plazo_dias: h.plazo_dias ?? null,
        fecha_vencimiento: h.fecha_vencimiento ? String(h.fecha_vencimiento).slice(0, 10) : null,
        moneda: h.moneda ?? "PYG",
        items: r.data.items.length
          ? r.data.items.map((it) => ({ descripcion: it.descripcion, cuenta_contable_id: it.cuenta_contable_id, subtotal: Number(it.subtotal), iva_tipo: it.iva_tipo }))
          : [emptyItem()],
      });
      setLoadingDetalle(false);
    });
  }, [mode, gastoId]);

  const totals = useMemo(() => {
    let sub = 0, iva = 0;
    for (const it of form.items) {
      const s = Number(it.subtotal) || 0;
      sub += s; iva += s * IVA_RATE[it.iva_tipo];
    }
    return { sub, iva, total: sub + iva };
  }, [form.items]);

  function setField<K extends keyof GastoHeaderForm>(k: K, v: GastoHeaderForm[K]) { setForm((f) => ({ ...f, [k]: v })); }
  function setItem(i: number, patch: Partial<GastoItemForm>) {
    setForm((f) => ({ ...f, items: f.items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)) }));
  }
  function setItemCuenta(i: number, id: string | null) {
    const c = cuentas.find((x) => x.id === id);
    setForm((f) => ({
      ...f,
      items: f.items.map((it, idx) =>
        idx === i
          ? { ...it, cuenta_contable_id: id, descripcion: it.descripcion.trim() ? it.descripcion : (c?.denominacion ?? "") }
          : it
      ),
    }));
  }
  function addItem() { setForm((f) => ({ ...f, items: [...f.items, emptyItem()] })); }
  function removeItem(i: number) { setForm((f) => ({ ...f, items: f.items.length > 1 ? f.items.filter((_, idx) => idx !== i) : f.items })); }

  async function guardar() {
    setBusy(true); setError(null);
    try {
      const r = mode === "nuevo" ? await crearBorrador(form)
        : mode === "completar" ? await completarHistorico(gastoId!, form)
        : await editarBorrador(gastoId!, form);
      if (!r.ok) { setError(r.error); return; }
      onSaved();
    } finally { setBusy(false); }
  }

  const titulo = mode === "nuevo" ? "Nuevo gasto o servicio" : mode === "completar" ? "Completar histórico" : "Editar borrador";

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center bg-slate-900/60 px-0 pt-0 backdrop-blur-sm sm:px-4 sm:pt-10" onClick={onClose}>
      <div className="flex h-[100dvh] max-h-[100dvh] w-full max-w-3xl flex-col rounded-none border-0 bg-white shadow-2xl sm:h-auto sm:max-h-[90dvh] sm:rounded-2xl sm:border" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b p-5">
          <h2 className="text-lg font-semibold text-slate-800">{titulo}</h2>
          <button onClick={onClose} className="text-xl text-slate-400 hover:text-slate-700">×</button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          {loadingDetalle ? (
            <p className="text-sm text-slate-400">Cargando…</p>
          ) : (
            <>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                El control financiero de deuda (Cuentas por Pagar y pagos a proveedores) se habilitará en la Fase 3. Aquí solo se registra el documento fiscal.
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Proveedor">
                  <select className={INPUT} value={form.proveedor_id ?? ""} onChange={(e) => setField("proveedor_id", e.target.value || null)}>
                    <option value="">(Sin proveedor)</option>
                    {proveedores.map((p) => <option key={p.id} value={String(p.id)}>{p.nombre}{p.ruc ? ` — ${p.ruc}` : ""}</option>)}
                  </select>
                </Field>
                <Field label="Tipo de comprobante">
                  <select className={INPUT} value={form.tipo_comprobante ?? ""} onChange={(e) => setField("tipo_comprobante", e.target.value || null)}>
                    {TIPO_COMPROBANTES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label="Número de comprobante"><input className={INPUT} inputMode="numeric" value={form.numero_comprobante ?? ""} onChange={(e) => setField("numero_comprobante", formatComprobante(e.target.value) || null)} placeholder="001-001-0000001" /></Field>
                <Field label="Timbrado"><input className={INPUT} value={form.timbrado ?? ""} onChange={(e) => setField("timbrado", e.target.value || null)} /></Field>
                <Field label="Fecha de comprobante"><input type="date" className={INPUT} value={form.fecha_comprobante ?? ""} onChange={(e) => setField("fecha_comprobante", e.target.value || null)} /></Field>
                <Field label="Fecha contable"><input type="date" className={INPUT} value={form.fecha_contable ?? ""} onChange={(e) => setField("fecha_contable", e.target.value || null)} /></Field>
                <Field label="Condición">
                  <select className={INPUT} value={form.tipo_pago ?? "contado"} onChange={(e) => setField("tipo_pago", e.target.value as "contado" | "credito")}>
                    <option value="contado">Contado</option>
                    <option value="credito">Crédito</option>
                  </select>
                </Field>
                {form.tipo_pago === "credito" && (
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Plazo (días)"><input type="number" className={INPUT} value={form.plazo_dias ?? ""} onChange={(e) => setField("plazo_dias", e.target.value ? parseInt(e.target.value) : null)} /></Field>
                    <Field label="Vencimiento"><input type="date" className={INPUT} value={form.fecha_vencimiento ?? ""} onChange={(e) => setField("fecha_vencimiento", e.target.value || null)} /></Field>
                  </div>
                )}
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Líneas (cuenta contable por línea)</h3>
                  <button onClick={addItem} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-[#3F8E91] hover:bg-slate-50">+ Agregar línea</button>
                </div>
                <div className="space-y-2">
                  {form.items.map((it, i) => {
                    const s = Number(it.subtotal) || 0;
                    const ivaLinea = s * IVA_RATE[it.iva_tipo];
                    return (
                      <div key={i} className="space-y-2 rounded-lg border border-slate-100 bg-slate-50 p-2">
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <CuentaCombobox cuentas={cuentas} value={it.cuenta_contable_id} onChange={(id) => setItemCuenta(i, id)} />
                          <input className={INPUT} placeholder="Descripción" value={it.descripcion} onChange={(e) => setItem(i, { descripcion: e.target.value })} />
                        </div>
                        <div className="flex items-center gap-2">
                          <input type="number" className={`${INPUT} flex-1`} placeholder="Monto base (sin IVA)" value={it.subtotal || ""} onChange={(e) => setItem(i, { subtotal: Number(e.target.value) || 0 })} />
                          <select className={`${INPUT} w-20`} value={it.iva_tipo} onChange={(e) => setItem(i, { iva_tipo: e.target.value as IvaTipo })}>
                            <option value="exenta">Ex.</option>
                            <option value="5">5%</option>
                            <option value="10">10%</option>
                          </select>
                          <span className="whitespace-nowrap text-[11px] text-slate-400">IVA {fmt(ivaLinea)}</span>
                          {form.items.length > 1 && <button onClick={() => removeItem(i)} className="px-1 text-red-500 hover:text-red-700" title="Quitar línea">×</button>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-4 rounded-lg bg-slate-50 p-3 text-sm">
                <span className="text-slate-500">Gravado/Exento: <b className="text-slate-800">{fmt(totals.sub)}</b></span>
                <span className="text-slate-500">IVA: <b className="text-slate-800">{fmt(totals.iva)}</b></span>
                <span className="text-slate-500">Total: <b className="text-slate-900">{fmt(totals.total)}</b></span>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t p-5">
          <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
          <button onClick={guardar} disabled={busy || loadingDetalle} className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50">
            {busy ? "Guardando…" : mode === "completar" ? "Guardar como borrador" : "Guardar borrador"}
          </button>
        </div>
      </div>
    </div>
  );
}

const INPUT = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/40 bg-white";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</label>
      {children}
    </div>
  );
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

/** Combobox pequeño con buscador inteligente para elegir la cuenta contable. */
function CuentaCombobox({
  cuentas, value, onChange,
}: {
  cuentas: CuentaContableOpcion[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const selected = cuentas.find((c) => c.id === value) ?? null;

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    const s = norm(q.trim());
    const base = s
      ? cuentas.filter((c) => c.cuenta.toLowerCase().includes(s) || norm(c.denominacion).includes(s))
      : cuentas;
    return base.slice(0, 40);
  }, [cuentas, q]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`${INPUT} flex items-center justify-between gap-2 text-left`}
      >
        <span className={`truncate ${selected ? "text-slate-700" : "text-slate-400"}`}>
          {selected ? `${selected.cuenta} — ${selected.denominacion}` : "(Cuenta contable)"}
        </span>
        <span className="shrink-0 text-slate-400">▾</span>
      </button>
      {open && (
        <div className="mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por código o denominación…"
            className="w-full border-b border-slate-100 px-2.5 py-2 text-sm outline-none"
          />
          <ul className="max-h-56 overflow-y-auto py-1">
            {selected && (
              <li>
                <button type="button" onClick={() => { onChange(null); setOpen(false); setQ(""); }}
                  className="block w-full px-2.5 py-1.5 text-left text-xs text-slate-400 hover:bg-slate-50">
                  (Quitar cuenta)
                </button>
              </li>
            )}
            {filtered.length === 0 ? (
              <li className="px-2.5 py-2 text-xs text-slate-400">Sin resultados</li>
            ) : filtered.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => { onChange(c.id); setOpen(false); setQ(""); }}
                  className={`block w-full px-2.5 py-1.5 text-left text-xs hover:bg-[#4FAEB2]/10 ${c.id === value ? "bg-[#4FAEB2]/10 font-semibold" : ""}`}
                >
                  <span className="font-mono text-slate-600">{c.cuenta}</span> — {c.denominacion}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
