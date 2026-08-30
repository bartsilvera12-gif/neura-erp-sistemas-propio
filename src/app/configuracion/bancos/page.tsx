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

type Banco = { id: string; nombre: string; activo: boolean; sort_order: number };
type Resp = { success?: boolean; error?: string; data?: { bancos: Banco[]; meta: { can_edit: boolean } } };

const BTN_PRIMARY =
  "rounded-lg bg-[#3F8E91] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#357a7d] disabled:opacity-50";
const BTN_GHOST =
  "rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50";

export default function ConfiguracionBancosPage() {
  const [bancos, setBancos] = useState<Banco[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editNombre, setEditNombre] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await apiFetch("/api/configuracion/bancos", { cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as Resp;
      if (!r.ok || !j.success || !j.data) {
        setError(j.error ?? `Error ${r.status}`);
        return;
      }
      setBancos(j.data.bancos);
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

  async function agregar() {
    const nombre = nuevo.trim();
    if (!nombre) return;
    setGuardando(true);
    setError(null);
    try {
      const r = await apiFetch("/api/configuracion/bancos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre }),
      });
      const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!r.ok || !j.success) {
        setError(j.error ?? `Error ${r.status}`);
        return;
      }
      setNuevo("");
      await cargar();
    } finally {
      setGuardando(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setError(null);
    const r = await apiFetch(`/api/configuracion/bancos/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string };
    if (!r.ok || !j.success) {
      setError(j.error ?? `Error ${r.status}`);
      return;
    }
    setEditId(null);
    await cargar();
  }

  return (
    <GlobalConfigSubpageShell
      title="Bancos"
      eyebrow="Finanzas"
      description="Catálogo de bancos de origen para los cobros por transferencia. Esta lista alimenta el desplegable “Banco de origen” de los botones de cobro."
    >
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}

      {canEdit ? (
        <ConfigFormCard>
          <ConfigSectionTitle>Agregar banco</ConfigSectionTitle>
          <ConfigHelpText>El nombre no se puede repetir. Los bancos desactivados no aparecen en el desplegable de cobros.</ConfigHelpText>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="min-w-[240px] flex-1">
              <label className={F_LABEL} htmlFor="nuevo-banco">Nombre del banco</label>
              <input
                id="nuevo-banco"
                className={F_INPUT}
                value={nuevo}
                onChange={(e) => setNuevo(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void agregar(); }}
                placeholder="Ej: Banco Continental"
              />
            </div>
            <button type="button" className={BTN_PRIMARY} onClick={() => void agregar()} disabled={guardando || !nuevo.trim()}>
              {guardando ? "Agregando…" : "Agregar"}
            </button>
          </div>
        </ConfigFormCard>
      ) : null}

      <ConfigFormCard>
        <ConfigSectionTitle>Bancos ({bancos.length})</ConfigSectionTitle>
        {cargando ? (
          <p className="py-6 text-center text-sm text-slate-400">Cargando…</p>
        ) : bancos.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">No hay bancos cargados todavía.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {bancos.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 py-2.5">
                {editId === b.id ? (
                  <>
                    <input
                      className={`${F_INPUT} min-w-[220px] flex-1`}
                      value={editNombre}
                      onChange={(e) => setEditNombre(e.target.value)}
                      autoFocus
                    />
                    <button type="button" className={BTN_PRIMARY} onClick={() => void patch(b.id, { nombre: editNombre })} disabled={!editNombre.trim()}>
                      Guardar
                    </button>
                    <button type="button" className={BTN_GHOST} onClick={() => setEditId(null)}>Cancelar</button>
                  </>
                ) : (
                  <>
                    <span className={`flex-1 text-sm ${b.activo ? "text-slate-800" : "text-slate-400 line-through"}`}>
                      {b.nombre}
                    </span>
                    {!b.activo ? (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">Inactivo</span>
                    ) : null}
                    {canEdit ? (
                      <>
                        <button
                          type="button"
                          className={BTN_GHOST}
                          onClick={() => { setEditId(b.id); setEditNombre(b.nombre); }}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className={BTN_GHOST}
                          onClick={() => void patch(b.id, { activo: !b.activo })}
                        >
                          {b.activo ? "Desactivar" : "Activar"}
                        </button>
                      </>
                    ) : null}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </ConfigFormCard>
    </GlobalConfigSubpageShell>
  );
}
