"use client";

/**
 * Configurar cajas (ADMIN): las cajas / puntos de venta de cada sucursal, con su depósito de
 * salida (de ahí se descuenta lo que se vende en esa caja). Alta, renombrar, cambiar de
 * depósito y desactivar. Con un turno abierto no se puede mover ni desactivar (lo valida la base).
 */
import { useState } from "react";
import { Loader2, Pencil, Plus, Warehouse } from "lucide-react";
import { apiFetch } from "@/erp2/lib/api/client-fetch";
import { Select } from "@/erp2/components/Select";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, ET, INPUT, ModalDocumento, TEAL } from "@/erp2/modules/inventario/ui";
import { invalidarCajas, type CajaPunto, type EstadoCajas, type SucursalCajas } from "@/erp2/modules/caja/turno";

type Edicion = { id: string | null; sucursal_id: string; nombre: string; deposito_id: string; activo: boolean; abierta: boolean };

export function ConfigurarCajasModal({ estado, onClose, onCambio }: { estado: EstadoCajas; onClose: () => void; onCambio: () => void }) {
  const [ed, setEd] = useState<Edicion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sucursales = estado.sucursales.filter((s) => s.activa);

  function nueva(s: SucursalCajas) {
    const principal = s.depositos.find((d) => d.es_principal && d.activo) ?? s.depositos.find((d) => d.activo);
    setError(null);
    setEd({ id: null, sucursal_id: s.id, nombre: `Caja ${s.cajas.length + 1}`, deposito_id: principal?.id ?? "", activo: true, abierta: false });
  }
  function editar(s: SucursalCajas, c: CajaPunto) {
    setError(null);
    setEd({ id: c.id, sucursal_id: s.id, nombre: c.nombre, deposito_id: c.deposito_id, activo: c.activo, abierta: !!c.turno });
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!ed || !ed.nombre.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/caja/cajas", {
        method: "POST",
        body: JSON.stringify({ id: ed.id, sucursal_id: ed.sucursal_id, nombre: ed.nombre.trim(), deposito_id: ed.deposito_id || null, activo: ed.activo }),
      });
      invalidarCajas();
      setEd(null);
      onCambio();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const sucEd = sucursales.find((s) => s.id === ed?.sucursal_id);

  return (
    <ModalDocumento titulo="Configurar cajas" subtitulo="Cada caja vende desde un depósito de su sucursal. Puede haber varias abiertas a la vez, una por caja." ancho="max-w-2xl"
      onClose={busy ? undefined : onClose}
      footer={<button type="button" onClick={onClose} className={BOTON_SECUNDARIO}>Listo</button>}>
      <div className="space-y-5">
        {sucursales.map((s) => (
          <section key={s.id} className="overflow-hidden rounded-2xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
              <p className="text-sm font-semibold text-slate-800">{s.nombre}</p>
              <button type="button" onClick={() => nueva(s)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs max-sm:min-h-11 font-semibold text-[var(--brand)] hover:bg-[var(--brand-50)]">
                <Plus className="h-3.5 w-3.5" /> Nueva caja
              </button>
            </div>
            <ul className="divide-y divide-slate-100">
              {s.cajas.length === 0 ? <li className="px-4 py-3 text-xs text-slate-400">Sin cajas.</li> : null}
              {s.cajas.map((c) => (
                <li key={c.id} className={`flex items-center justify-between gap-3 px-4 py-2.5 ${c.activo ? "" : "bg-slate-50/70"}`}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">
                      {c.nombre}
                      {c.turno ? <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">Abierta</span> : null}
                      {!c.activo ? <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">Inactiva</span> : null}
                    </p>
                    <p className="flex items-center gap-1 text-[11px] text-slate-500"><Warehouse className="h-3 w-3" /> Sale de {c.deposito_nombre}</p>
                  </div>
                  <button type="button" onClick={() => editar(s, c)} title="Editar caja" aria-label={`Editar ${c.nombre}`} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg p-2 text-slate-400 sm:h-auto sm:w-auto hover:bg-[var(--brand-50)] hover:text-[var(--brand)]"><Pencil className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
            {ed && ed.sucursal_id === s.id ? (
              <form onSubmit={guardar} className="space-y-3 border-t border-slate-100 bg-[var(--brand-50)]/40 px-4 py-4">
                <p className="text-xs font-semibold text-slate-700">{ed.id ? "Editar caja" : "Nueva caja"}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className={ET}>Nombre *</span>
                    <input autoFocus value={ed.nombre} onChange={(e) => setEd({ ...ed, nombre: e.target.value })} maxLength={60} placeholder="Ej. Caja 2" className={INPUT} />
                  </label>
                  <div>
                    <span className={ET}>Depósito de salida</span>
                    <Select value={ed.deposito_id} onChange={(v) => setEd({ ...ed, deposito_id: v })} block disabled={ed.abierta}
                      options={(sucEd?.depositos ?? []).filter((d) => d.activo || d.id === ed.deposito_id).map((d): [string, string] => [d.id, `${d.nombre}${d.es_principal ? " (principal)" : ""}`])} />
                  </div>
                </div>
                {ed.id ? (
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={ed.activo} disabled={ed.abierta} onChange={(e) => setEd({ ...ed, activo: e.target.checked })} className="h-4 w-4 accent-[var(--brand)]" />
                    Activa {ed.abierta ? <span className="text-[11px] text-slate-400">(está abierta: cerrala para desactivarla o cambiar su depósito)</span> : null}
                  </label>
                ) : null}
                {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setEd(null)} disabled={busy} className={BOTON_SECUNDARIO}>Cancelar</button>
                  <button type="submit" disabled={busy || !ed.nombre.trim()} className={BOTON_PRIMARIO} style={{ backgroundColor: TEAL }}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {ed.id ? "Guardar" : "Crear caja"}
                  </button>
                </div>
              </form>
            ) : null}
          </section>
        ))}
        <p className="text-[11px] text-slate-400">Las sucursales y sus depósitos se configuran en Inventario › Depósitos.</p>
      </div>
    </ModalDocumento>
  );
}
