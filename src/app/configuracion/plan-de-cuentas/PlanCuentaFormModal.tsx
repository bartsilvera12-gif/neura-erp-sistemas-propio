"use client";

import { useEffect, useMemo, useState } from "react";
import { F_INPUT, F_LABEL, F_SELECT } from "@/components/config/global-config-primitives";
import type { CuentaFormDraft, PlanCuentaItem } from "./types";

const MONEDAS = ["Local", "DOLAR"];
const TIPOS_CAMBIO = ["", "Comprador", "Vendedor"];

function emptyDraft(): CuentaFormDraft {
  return {
    cuenta: "",
    denominacion: "",
    cuenta_padre_id: null,
    nivel: 1,
    naturaleza: "D",
    asentable: true,
    centro_costo: false,
    moneda: "Local",
    tipo_cambio: "",
    cuenta_sset: "",
    activo: true,
  };
}

export function PlanCuentaFormModal({
  open,
  editing,
  cuentas,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: PlanCuentaItem | null;
  cuentas: PlanCuentaItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<CuentaFormDraft>(emptyDraft());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editing) {
      setDraft({
        cuenta: editing.cuenta,
        denominacion: editing.denominacion,
        cuenta_padre_id: editing.cuenta_padre_id,
        nivel: editing.nivel,
        naturaleza: editing.naturaleza,
        asentable: editing.asentable,
        centro_costo: editing.centro_costo,
        moneda: editing.moneda ?? "",
        tipo_cambio: editing.tipo_cambio ?? "",
        cuenta_sset: editing.cuenta_sset ?? "",
        activo: editing.activo,
      });
    } else {
      setDraft(emptyDraft());
    }
  }, [open, editing]);

  // Opciones de padre: todas menos la propia cuenta (al editar).
  const padreOptions = useMemo(
    () =>
      cuentas
        .filter((c) => !editing || c.id !== editing.id)
        .sort((a, b) => a.cuenta.localeCompare(b.cuenta)),
    [cuentas, editing]
  );

  function setField<K extends keyof CuentaFormDraft>(k: K, v: CuentaFormDraft[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
  }

  // Al elegir padre, sugerir nivel = padre.nivel + 1.
  function onSelectPadre(id: string) {
    const padreId = id === "" ? null : id;
    setDraft((d) => {
      const padre = cuentas.find((c) => c.id === padreId);
      return { ...d, cuenta_padre_id: padreId, nivel: padre ? padre.nivel + 1 : d.nivel };
    });
  }

  async function handleSubmit() {
    setBusy(true);
    setError(null);
    try {
      const { apiFetch } = await import("@/lib/api/fetch-with-supabase-session");
      const payload = {
        cuenta: draft.cuenta.trim(),
        denominacion: draft.denominacion.trim(),
        cuenta_padre_id: draft.cuenta_padre_id,
        nivel: draft.nivel,
        naturaleza: draft.naturaleza,
        asentable: draft.asentable,
        centro_costo: draft.centro_costo,
        moneda: draft.moneda.trim() || null,
        tipo_cambio: draft.tipo_cambio.trim() || null,
        cuenta_sset: draft.cuenta_sset.trim() || null,
        activo: draft.activo,
      };
      const url = editing
        ? `/api/configuracion/plan-cuentas/${editing.id}`
        : `/api/configuracion/plan-cuentas`;
      const r = await apiFetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setError(j?.error ?? `Error ${r.status}`);
        return;
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center bg-slate-900/60 backdrop-blur-sm px-0 pt-0 sm:px-4 sm:pt-16"
      onClick={onClose}
    >
      <div
        className="flex h-[100dvh] max-h-[100dvh] w-full max-w-2xl flex-col rounded-none border-0 bg-white shadow-2xl sm:h-auto sm:max-h-[88dvh] sm:rounded-2xl sm:border sm:border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b p-5">
          <h2 className="text-lg font-semibold text-slate-800">
            {editing ? `Editar cuenta ${editing.cuenta}` : "Nueva cuenta"}
          </h2>
          <button onClick={onClose} className="text-xl text-slate-400 hover:text-slate-700">
            ×
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={F_LABEL}>Código *</label>
              <input
                className={F_INPUT}
                value={draft.cuenta}
                onChange={(e) => setField("cuenta", e.target.value)}
                placeholder="Ej. 11115"
              />
            </div>
            <div>
              <label className={F_LABEL}>Nivel *</label>
              <input
                type="number"
                min={1}
                className={F_INPUT}
                value={draft.nivel}
                onChange={(e) => setField("nivel", Number(e.target.value))}
              />
            </div>
          </div>

          <div>
            <label className={F_LABEL}>Denominación *</label>
            <input
              className={F_INPUT}
              value={draft.denominacion}
              onChange={(e) => setField("denominacion", e.target.value)}
              placeholder="Nombre de la cuenta"
            />
          </div>

          <div>
            <label className={F_LABEL}>Cuenta padre</label>
            <select
              className={F_SELECT}
              value={draft.cuenta_padre_id ?? ""}
              onChange={(e) => onSelectPadre(e.target.value)}
            >
              <option value="">(Sin padre — cuenta raíz)</option>
              {padreOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.cuenta} · {c.denominacion} (nivel {c.nivel})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={F_LABEL}>Naturaleza *</label>
              <select
                className={F_SELECT}
                value={draft.naturaleza}
                onChange={(e) => setField("naturaleza", e.target.value as "D" | "A")}
              >
                <option value="D">D — Deudora</option>
                <option value="A">A — Acreedora</option>
              </select>
            </div>
            <div>
              <label className={F_LABEL}>Moneda</label>
              <select className={F_SELECT} value={draft.moneda} onChange={(e) => setField("moneda", e.target.value)}>
                <option value="">(Ninguna)</option>
                {MONEDAS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={F_LABEL}>Tipo de cambio</label>
              <select
                className={F_SELECT}
                value={draft.tipo_cambio}
                onChange={(e) => setField("tipo_cambio", e.target.value)}
              >
                {TIPOS_CAMBIO.map((t) => (
                  <option key={t} value={t}>
                    {t === "" ? "(Ninguno)" : t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={F_LABEL}>Cuenta SSET</label>
              <input
                className={F_INPUT}
                value={draft.cuenta_sset}
                onChange={(e) => setField("cuenta_sset", e.target.value)}
                placeholder="Ej. 1 01 01 01"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2.5 rounded-xl border border-slate-100 bg-slate-50 p-4 sm:flex-row sm:flex-wrap sm:gap-6">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={draft.asentable} onChange={(e) => setField("asentable", e.target.checked)} />
              Asentable (imputable)
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={draft.centro_costo}
                onChange={(e) => setField("centro_costo", e.target.checked)}
              />
              Requiere centro de costo
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={draft.activo} onChange={(e) => setField("activo", e.target.checked)} />
              Activa
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t p-5">
          <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={busy || !draft.cuenta.trim() || !draft.denominacion.trim()}
            className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50"
          >
            {busy ? "Guardando…" : editing ? "Guardar cambios" : "Crear cuenta"}
          </button>
        </div>
      </div>
    </div>
  );
}
