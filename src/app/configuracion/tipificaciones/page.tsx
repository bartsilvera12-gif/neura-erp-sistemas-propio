"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { GlobalConfigSubpageShell } from "@/components/config/GlobalConfigSubpageShell";
import {
  ConfigFormCard,
  ConfigHelpText,
  ConfigSectionTitle,
  F_INPUT,
  F_LABEL,
} from "@/components/config/global-config-primitives";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";

// Modelo de 2 niveles:
//   ESTADO     (Solicitud / Reclamo / Consulta) -> nivel de API "familia"
//   SUB-ESTADO (la cosa puntual, lleva la acción) -> nivel de API "estado"
type NivelApi = "familia" | "estado";
type Nodo = { id: string; nombre: string; activo: boolean; sort_order: number; comportamiento?: string | null };
type SubEstado = Nodo;
type Estado = Nodo & { subestados: SubEstado[] };
type Resp = { success?: boolean; error?: string; data?: { familias: Estado[]; meta: { can_edit: boolean } } };

/** Acciones que puede disparar un sub-estado al tipificar. */
const COMPORTAMIENTOS: { value: string; label: string }[] = [
  { value: "", label: "Sin acción" },
  { value: "ticket_error", label: "Crea ticket de Error (Soporte)" },
  { value: "ticket_cambio", label: "Crea ticket de Cambio (Soporte)" },
  { value: "capacitacion", label: "Agenda capacitación" },
];
const compLabel = (v?: string | null) => COMPORTAMIENTOS.find((c) => c.value === (v ?? ""))?.label ?? "Sin acción";

const BTN_PRIMARY =
  "rounded-lg bg-[#3F8E91] px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#357a7d] disabled:opacity-50";
const BTN_GHOST =
  "rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50";
const BTN_DANGER =
  "rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50";

export default function ConfiguracionTipificacionesPage() {
  const [estados, setEstados] = useState<Estado[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [nuevoEstado, setNuevoEstado] = useState("");
  const [nuevoSub, setNuevoSub] = useState<Record<string, string>>({});
  const [nuevoSubComp, setNuevoSubComp] = useState<Record<string, string>>({});

  const [editId, setEditId] = useState<string | null>(null);
  const [editNombre, setEditNombre] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await apiFetch("/api/configuracion/tipificaciones", { cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as Resp;
      if (!r.ok || !j.success || !j.data) {
        setError(j.error ?? `Error ${r.status}`);
        return;
      }
      setEstados(j.data.familias);
      setCanEdit(j.data.meta.can_edit);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function crear(nivel: NivelApi, nombre: string, parentId?: string, extra?: Record<string, unknown>) {
    const nom = nombre.trim();
    if (!nom || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch("/api/configuracion/tipificaciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nivel, nombre: nom, parent_id: parentId, ...(extra ?? {}) }),
      });
      const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!r.ok || !j.success) {
        setError(j.error ?? `Error ${r.status}`);
        return;
      }
      await cargar();
    } finally {
      setBusy(false);
    }
  }

  async function patchNodo(nivel: NivelApi, id: string, body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch(`/api/configuracion/tipificaciones/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nivel, ...body }),
      });
      const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!r.ok || !j.success) {
        setError(j.error ?? `Error ${r.status}`);
        return;
      }
      setEditId(null);
      await cargar();
    } finally {
      setBusy(false);
    }
  }

  async function eliminar(nivel: NivelApi, id: string, aviso: string) {
    if (busy) return;
    if (!window.confirm(aviso)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch(`/api/configuracion/tipificaciones/${id}?nivel=${nivel}`, { method: "DELETE" });
      const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!r.ok || !j.success) {
        setError(j.error ?? `Error ${r.status}`);
        return;
      }
      await cargar();
    } finally {
      setBusy(false);
    }
  }

  /** Fila editable (nombre + acciones) para Estado o Sub-estado. `extra` se
   *  renderiza al lado del nombre (ej. el selector de Acción del sub-estado). */
  function Fila({ nivel, nodo, aviso, extra }: { nivel: NivelApi; nodo: Nodo; aviso: string; extra?: ReactNode }) {
    if (editId === nodo.id) {
      return (
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={`${F_INPUT} min-w-[200px] flex-1`}
            value={editNombre}
            onChange={(e) => setEditNombre(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void patchNodo(nivel, nodo.id, { nombre: editNombre }); }}
            autoFocus
          />
          <button type="button" className={BTN_PRIMARY} onClick={() => void patchNodo(nivel, nodo.id, { nombre: editNombre })} disabled={busy || !editNombre.trim()}>Guardar</button>
          <button type="button" className={BTN_GHOST} onClick={() => setEditId(null)}>Cancelar</button>
        </div>
      );
    }
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-sm ${nodo.activo ? "text-slate-800" : "text-slate-400 line-through"}`}>{nodo.nombre}</span>
        {!nodo.activo ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">Inactivo</span> : null}
        {extra}
        {canEdit ? (
          <div className="ml-auto flex items-center gap-2">
            <button type="button" className={BTN_GHOST} onClick={() => { setEditId(nodo.id); setEditNombre(nodo.nombre); }}>Editar</button>
            <button type="button" className={BTN_GHOST} onClick={() => void patchNodo(nivel, nodo.id, { activo: !nodo.activo })} disabled={busy}>{nodo.activo ? "Desactivar" : "Activar"}</button>
            <button type="button" className={BTN_DANGER} onClick={() => void eliminar(nivel, nodo.id, aviso)} disabled={busy}>Eliminar</button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <GlobalConfigSubpageShell
      title="Tipificaciones"
      eyebrow="Gestión de clientes"
      description="Estados de tipificación (Solicitud, Reclamo, Consulta…) y sus sub-estados. La acción (crear ticket de Soporte o agendar capacitación) vive en el sub-estado. Es el catálogo que se usa al tipificar la gestión de un cliente."
    >
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

      {canEdit ? (
        <ConfigFormCard>
          <ConfigSectionTitle>Agregar estado</ConfigSectionTitle>
          <ConfigHelpText>El estado es el nivel de arriba (Solicitud, Reclamo, Consulta…). Después le cargás sus sub-estados. Lo desactivado no se ofrece al tipificar.</ConfigHelpText>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="min-w-[240px] flex-1">
              <label className={F_LABEL} htmlFor="nuevo-estado">Nombre del estado</label>
              <input
                id="nuevo-estado"
                className={F_INPUT}
                value={nuevoEstado}
                onChange={(e) => setNuevoEstado(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { void crear("familia", nuevoEstado); setNuevoEstado(""); } }}
                placeholder="Ej: Solicitud, Reclamo, Consulta…"
              />
            </div>
            <button type="button" className={BTN_PRIMARY} onClick={() => { void crear("familia", nuevoEstado); setNuevoEstado(""); }} disabled={busy || !nuevoEstado.trim()}>Agregar estado</button>
          </div>
        </ConfigFormCard>
      ) : null}

      <ConfigFormCard>
        <ConfigSectionTitle>Estados ({estados.length})</ConfigSectionTitle>
        {cargando ? (
          <p className="py-6 text-center text-sm text-slate-400">Cargando…</p>
        ) : estados.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">No hay estados de tipificación todavía.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {estados.map((est) => (
              <div key={est.id} className="rounded-xl border border-slate-200 bg-white">
                <div className="border-b border-slate-100 bg-slate-50/70 px-3 py-2.5">
                  <Fila nivel="familia" nodo={est} aviso={`¿Eliminar el estado "${est.nombre}" y todos sus sub-estados?`} />
                </div>

                <div className="space-y-1.5 px-3 py-3 sm:pl-6">
                  {est.subestados.length === 0 ? (
                    <p className="text-xs text-slate-400">Sin sub-estados todavía.</p>
                  ) : (
                    est.subestados.map((s) => (
                      <div key={s.id} className="rounded-lg border border-slate-100 px-2.5 py-2">
                        <Fila
                          nivel="estado"
                          nodo={s}
                          aviso={`¿Eliminar el sub-estado "${s.nombre}"?`}
                          extra={
                            <span className="inline-flex items-center gap-1.5">
                              <span className="text-[10px] font-medium text-slate-400">Acción:</span>
                              {canEdit ? (
                                <select
                                  className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-700 focus:border-[#4FAEB2] focus:outline-none"
                                  value={s.comportamiento ?? ""}
                                  onChange={(ev) => void patchNodo("estado", s.id, { comportamiento: ev.target.value })}
                                  disabled={busy}
                                >
                                  {COMPORTAMIENTOS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                                </select>
                              ) : (
                                <span className="text-[11px] text-slate-500">{compLabel(s.comportamiento)}</span>
                              )}
                            </span>
                          }
                        />
                      </div>
                    ))
                  )}
                  {canEdit ? (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <input
                        className={`${F_INPUT} h-9 min-w-[200px] flex-1`}
                        value={nuevoSub[est.id] ?? ""}
                        onChange={(ev) => setNuevoSub((m) => ({ ...m, [est.id]: ev.target.value }))}
                        onKeyDown={(ev) => { if (ev.key === "Enter") { void crear("estado", nuevoSub[est.id] ?? "", est.id, { comportamiento: nuevoSubComp[est.id] ?? "" }); setNuevoSub((m) => ({ ...m, [est.id]: "" })); setNuevoSubComp((m) => ({ ...m, [est.id]: "" })); } }}
                        placeholder="Nuevo sub-estado… (ej: Cliente solicita nueva contraseña)"
                      />
                      <select
                        className="h-9 rounded-md border border-slate-200 bg-white px-2 text-[11px] text-slate-700 focus:border-[#4FAEB2] focus:outline-none"
                        value={nuevoSubComp[est.id] ?? ""}
                        onChange={(ev) => setNuevoSubComp((m) => ({ ...m, [est.id]: ev.target.value }))}
                        title="Acción que dispara este sub-estado"
                      >
                        {COMPORTAMIENTOS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                      <button type="button" className={BTN_GHOST} onClick={() => { void crear("estado", nuevoSub[est.id] ?? "", est.id, { comportamiento: nuevoSubComp[est.id] ?? "" }); setNuevoSub((m) => ({ ...m, [est.id]: "" })); setNuevoSubComp((m) => ({ ...m, [est.id]: "" })); }} disabled={busy || !(nuevoSub[est.id] ?? "").trim()}>
                        + Sub-estado
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </ConfigFormCard>
    </GlobalConfigSubpageShell>
  );
}
