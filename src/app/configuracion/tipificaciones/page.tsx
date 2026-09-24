"use client";

import { useCallback, useEffect, useState } from "react";
import { GlobalConfigSubpageShell } from "@/components/config/GlobalConfigSubpageShell";
import {
  ConfigFormCard,
  ConfigHelpText,
  ConfigSectionTitle,
  F_INPUT,
  F_LABEL,
} from "@/components/config/global-config-primitives";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";

type Nivel = "familia" | "estado" | "subestado";
type Nodo = { id: string; nombre: string; activo: boolean; sort_order: number };
type Estado = Nodo & { subestados: Nodo[] };
type Familia = Nodo & { comportamiento?: string | null; estados: Estado[] };
type Resp = { success?: boolean; error?: string; data?: { familias: Familia[]; meta: { can_edit: boolean } } };

/** Superpoderes que puede disparar una familia al tipificar. */
const COMPORTAMIENTOS: { value: string; label: string }[] = [
  { value: "", label: "Sin comportamiento" },
  { value: "ticket_error", label: "Crea ticket de Error (Soporte)" },
  { value: "ticket_cambio", label: "Crea ticket de Cambio (Soporte)" },
  { value: "capacitacion", label: "Agenda capacitación" },
];
const compLabel = (v?: string | null) => COMPORTAMIENTOS.find((c) => c.value === (v ?? ""))?.label ?? "Sin comportamiento";

const BTN_PRIMARY =
  "rounded-lg bg-[#3F8E91] px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#357a7d] disabled:opacity-50";
const BTN_GHOST =
  "rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50";
const BTN_DANGER =
  "rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50";

export default function ConfiguracionTipificacionesPage() {
  const [familias, setFamilias] = useState<Familia[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Inputs de alta por nivel (familia global; estado por familia; sub por estado).
  const [nuevaFamilia, setNuevaFamilia] = useState("");
  const [nuevaFamiliaComp, setNuevaFamiliaComp] = useState("");
  const [nuevoEstado, setNuevoEstado] = useState<Record<string, string>>({});
  const [nuevoSub, setNuevoSub] = useState<Record<string, string>>({});

  // Edición inline (un nodo a la vez, por id).
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
      setFamilias(j.data.familias);
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

  async function crear(nivel: Nivel, nombre: string, parentId?: string, extra?: Record<string, unknown>) {
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

  async function patchNodo(nivel: Nivel, id: string, body: Record<string, unknown>) {
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

  async function eliminar(nivel: Nivel, id: string, aviso: string) {
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

  /** Fila editable reusable (nombre + acciones) para cualquier nivel. */
  function Fila({
    nivel,
    nodo,
    hijosAviso,
  }: {
    nivel: Nivel;
    nodo: Nodo;
    hijosAviso: string;
  }) {
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
          <button type="button" className={BTN_PRIMARY} onClick={() => void patchNodo(nivel, nodo.id, { nombre: editNombre })} disabled={busy || !editNombre.trim()}>
            Guardar
          </button>
          <button type="button" className={BTN_GHOST} onClick={() => setEditId(null)}>Cancelar</button>
        </div>
      );
    }
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className={`flex-1 text-sm ${nodo.activo ? "text-slate-800" : "text-slate-400 line-through"}`}>
          {nodo.nombre}
        </span>
        {!nodo.activo ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">Inactivo</span>
        ) : null}
        {canEdit ? (
          <>
            <button type="button" className={BTN_GHOST} onClick={() => { setEditId(nodo.id); setEditNombre(nodo.nombre); }}>Editar</button>
            <button type="button" className={BTN_GHOST} onClick={() => void patchNodo(nivel, nodo.id, { activo: !nodo.activo })} disabled={busy}>
              {nodo.activo ? "Desactivar" : "Activar"}
            </button>
            <button type="button" className={BTN_DANGER} onClick={() => void eliminar(nivel, nodo.id, hijosAviso)} disabled={busy}>Eliminar</button>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <GlobalConfigSubpageShell
      title="Tipificaciones"
      eyebrow="Gestión de clientes"
      description="Familias de tipificación, cada una con sus estados y sub-estados. Es el catálogo que se usa al tipificar la gestión de un cliente."
    >
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}

      {canEdit ? (
        <ConfigFormCard>
          <ConfigSectionTitle>Agregar familia</ConfigSectionTitle>
          <ConfigHelpText>Cada familia agrupa estados; cada estado, sus sub-estados. Lo desactivado no se ofrece al tipificar.</ConfigHelpText>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1">
              <label className={F_LABEL} htmlFor="nueva-familia">Nombre de la familia</label>
              <input
                id="nueva-familia"
                className={F_INPUT}
                value={nuevaFamilia}
                onChange={(e) => setNuevaFamilia(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { void crear("familia", nuevaFamilia, undefined, { comportamiento: nuevaFamiliaComp }); setNuevaFamilia(""); setNuevaFamiliaComp(""); } }}
                placeholder="Ej: Solicitud, Reclamo, Consulta…"
              />
            </div>
            <div className="min-w-[220px]">
              <label className={F_LABEL} htmlFor="nueva-familia-comp">Comportamiento</label>
              <select
                id="nueva-familia-comp"
                className={F_INPUT}
                value={nuevaFamiliaComp}
                onChange={(e) => setNuevaFamiliaComp(e.target.value)}
              >
                {COMPORTAMIENTOS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <button type="button" className={BTN_PRIMARY} onClick={() => { void crear("familia", nuevaFamilia, undefined, { comportamiento: nuevaFamiliaComp }); setNuevaFamilia(""); setNuevaFamiliaComp(""); }} disabled={busy || !nuevaFamilia.trim()}>
              Agregar familia
            </button>
          </div>
        </ConfigFormCard>
      ) : null}

      <ConfigFormCard>
        <ConfigSectionTitle>Familias ({familias.length})</ConfigSectionTitle>
        {cargando ? (
          <p className="py-6 text-center text-sm text-slate-400">Cargando…</p>
        ) : familias.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">No hay familias de tipificación todavía.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {familias.map((f) => (
              <div key={f.id} className="rounded-xl border border-slate-200 bg-white">
                <div className="border-b border-slate-100 bg-slate-50/70 px-3 py-2.5">
                  <Fila nivel="familia" nodo={f} hijosAviso={`¿Eliminar la familia "${f.nombre}" y todos sus estados y sub-estados?`} />
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-medium text-slate-400">Comportamiento:</span>
                    {canEdit ? (
                      <select
                        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 focus:border-[#4FAEB2] focus:outline-none"
                        value={f.comportamiento ?? ""}
                        onChange={(e) => void patchNodo("familia", f.id, { comportamiento: e.target.value })}
                        disabled={busy}
                      >
                        {COMPORTAMIENTOS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    ) : (
                      <span className="text-[11px] text-slate-600">{compLabel(f.comportamiento)}</span>
                    )}
                  </div>
                </div>

                <div className="space-y-2 px-3 py-3 sm:pl-6">
                  {f.estados.length === 0 ? (
                    <p className="text-xs text-slate-400">Sin estados todavía.</p>
                  ) : (
                    f.estados.map((e) => (
                      <div key={e.id} className="rounded-lg border border-slate-100">
                        <div className="border-b border-slate-100 px-2.5 py-2">
                          <Fila nivel="estado" nodo={e} hijosAviso={`¿Eliminar el estado "${e.nombre}" y sus sub-estados?`} />
                        </div>
                        <div className="space-y-1.5 px-2.5 py-2 sm:pl-6">
                          {e.subestados.length === 0 ? (
                            <p className="text-[11px] text-slate-300">Sin sub-estados.</p>
                          ) : (
                            e.subestados.map((s) => (
                              <div key={s.id} className="border-l-2 border-slate-100 pl-2.5">
                                <Fila nivel="subestado" nodo={s} hijosAviso={`¿Eliminar el sub-estado "${s.nombre}"?`} />
                              </div>
                            ))
                          )}
                          {canEdit ? (
                            <div className="flex items-center gap-2 pt-1">
                              <input
                                className={`${F_INPUT} h-8 flex-1 text-xs`}
                                value={nuevoSub[e.id] ?? ""}
                                onChange={(ev) => setNuevoSub((m) => ({ ...m, [e.id]: ev.target.value }))}
                                onKeyDown={(ev) => { if (ev.key === "Enter") { void crear("subestado", nuevoSub[e.id] ?? "", e.id); setNuevoSub((m) => ({ ...m, [e.id]: "" })); } }}
                                placeholder="Nuevo sub-estado…"
                              />
                              <button type="button" className={BTN_GHOST} onClick={() => { void crear("subestado", nuevoSub[e.id] ?? "", e.id); setNuevoSub((m) => ({ ...m, [e.id]: "" })); }} disabled={busy || !(nuevoSub[e.id] ?? "").trim()}>
                                + Sub-estado
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))
                  )}
                  {canEdit ? (
                    <div className="flex items-center gap-2 pt-1">
                      <input
                        className={`${F_INPUT} h-9 flex-1`}
                        value={nuevoEstado[f.id] ?? ""}
                        onChange={(ev) => setNuevoEstado((m) => ({ ...m, [f.id]: ev.target.value }))}
                        onKeyDown={(ev) => { if (ev.key === "Enter") { void crear("estado", nuevoEstado[f.id] ?? "", f.id); setNuevoEstado((m) => ({ ...m, [f.id]: "" })); } }}
                        placeholder="Nuevo estado…"
                      />
                      <button type="button" className={BTN_GHOST} onClick={() => { void crear("estado", nuevoEstado[f.id] ?? "", f.id); setNuevoEstado((m) => ({ ...m, [f.id]: "" })); }} disabled={busy || !(nuevoEstado[f.id] ?? "").trim()}>
                        + Estado
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
