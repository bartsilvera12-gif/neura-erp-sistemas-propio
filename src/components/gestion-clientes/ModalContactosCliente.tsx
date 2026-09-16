"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Mail, Pencil, Phone, Plus, Trash2, UserRound, Users, X } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Contacto = {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  cargo: string | null;
  notas: string | null;
};

type Form = { nombre: string; telefono: string; email: string; cargo: string; notas: string };
const VACIO: Form = { nombre: "", telefono: "", email: "", cargo: "", notas: "" };

async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...resto } = init ?? {};
  const res = await fetchWithSupabaseSession(url, {
    cache: "no-store",
    ...resto,
    headers: json !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  const j = (await res.json().catch(() => null)) as { success?: boolean; data?: T; error?: string } | null;
  if (!res.ok || !j?.success) throw new Error(j?.error || `Error ${res.status}`);
  return j.data as T;
}

const claseCampo =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20";
const claseEtiqueta = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500";

/**
 * Contactos secundarios del cliente: otras personas que hablan en su nombre
 * (dueño, administración, cajera…). Sus teléfonos también sirven para
 * reconocer al cliente cuando escribe por el chat.
 */
export function ModalContactosCliente({
  clienteId,
  clienteNombre,
  onClose,
}: {
  clienteId: string;
  clienteNombre: string;
  onClose: () => void;
}) {
  const [lista, setLista] = useState<Contacto[] | null>(null);
  const [form, setForm] = useState<Form>(VACIO);
  const [editando, setEditando] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = `/api/clientes/${clienteId}/contactos`;
  const cargar = useCallback(async () => {
    try {
      setLista(await api<Contacto[]>(url));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los contactos");
    }
  }, [url]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && !guardando && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose, guardando]);

  const nuevo = () => {
    setForm(VACIO);
    setEditando(null);
    setAbierto(true);
    setError(null);
  };

  const editar = (c: Contacto) => {
    setForm({ nombre: c.nombre, telefono: c.telefono ?? "", email: c.email ?? "", cargo: c.cargo ?? "", notas: c.notas ?? "" });
    setEditando(c.id);
    setAbierto(true);
    setError(null);
  };

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    try {
      if (editando) await api(`${url}/${editando}`, { method: "PATCH", json: form });
      else await api(url, { method: "POST", json: form });
      setAbierto(false);
      setForm(VACIO);
      setEditando(null);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };

  const quitar = async (c: Contacto) => {
    if (!window.confirm(`¿Quitar a ${c.nombre} de los contactos del cliente?`)) return;
    setError(null);
    try {
      await api(`${url}/${c.id}`, { method: "DELETE" });
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo quitar");
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/40 p-4" role="presentation" onClick={() => !guardando && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="contactos-cliente-titulo"
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl ring-1 ring-[#4FAEB2]/15"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-slate-100 bg-gradient-to-r from-[#4FAEB2]/12 via-[#4FAEB2]/5 to-transparent px-5 py-4">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#4FAEB2]/15 text-[#2F6E71]">
            <Users className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="contactos-cliente-titulo" className="text-[16px] font-semibold text-slate-900">Contactos del cliente</h2>
            <p className="truncate text-[12.5px] text-slate-500">{clienteNombre} · sus teléfonos también reconocen al cliente en el chat</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-slate-400 hover:bg-white/70 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {lista == null ? (
            <p className="flex items-center gap-2 py-6 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cargando…
            </p>
          ) : lista.length === 0 && !abierto ? (
            <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
              Este cliente todavía no tiene contactos secundarios.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {lista.map((c) => (
                <li key={c.id} className="flex items-start gap-3 px-3.5 py-2.5">
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500">
                    <UserRound className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-semibold text-slate-800">
                      {c.nombre}
                      {c.cargo ? <span className="ml-1.5 font-medium text-slate-400">· {c.cargo}</span> : null}
                    </p>
                    <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12.5px] text-slate-600">
                      {c.telefono ? <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3 text-slate-400" aria-hidden />{c.telefono}</span> : null}
                      {c.email ? <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3 text-slate-400" aria-hidden />{c.email}</span> : null}
                    </p>
                    {c.notas ? <p className="mt-0.5 text-[12px] text-slate-400">{c.notas}</p> : null}
                  </div>
                  <button type="button" onClick={() => editar(c)} aria-label={`Editar ${c.nombre}`} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => void quitar(c)} aria-label={`Quitar ${c.nombre}`} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {abierto ? (
            <div className="space-y-3 rounded-xl border border-[#4FAEB2]/30 bg-[#4FAEB2]/[0.04] p-3.5">
              <p className="text-[13px] font-semibold text-slate-700">{editando ? "Editar contacto" : "Nuevo contacto"}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <span className={claseEtiqueta}>Nombre *</span>
                  <input className={claseCampo} value={form.nombre} maxLength={150} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} placeholder="Ej.: María Gómez" autoFocus />
                </div>
                <div>
                  <span className={claseEtiqueta}>Cargo</span>
                  <input className={claseCampo} value={form.cargo} maxLength={100} onChange={(e) => setForm((f) => ({ ...f, cargo: e.target.value }))} placeholder="Ej.: Administración" />
                </div>
                <div>
                  <span className={claseEtiqueta}>Teléfono</span>
                  <input className={claseCampo} value={form.telefono} maxLength={40} inputMode="tel" onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))} placeholder="Ej.: 0981 123 456" />
                </div>
                <div>
                  <span className={claseEtiqueta}>Correo</span>
                  <input className={claseCampo} value={form.email} maxLength={150} type="email" onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="Ej.: maria@empresa.com" />
                </div>
              </div>
              <div>
                <span className={claseEtiqueta}>Notas</span>
                <input className={claseCampo} value={form.notas} maxLength={1000} onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))} placeholder="Opcional" />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setAbierto(false)} disabled={guardando} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-600 hover:bg-slate-50">
                  Cancelar
                </button>
                <button type="button" onClick={() => void guardar()} disabled={guardando} className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-60">
                  {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                  {editando ? "Guardar cambios" : "Agregar contacto"}
                </button>
              </div>
            </div>
          ) : null}

          {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p> : null}
        </div>

        {!abierto ? (
          <div className="flex justify-end border-t border-slate-100 px-5 py-3">
            <button type="button" onClick={nuevo} className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-[#3F8E91]">
              <Plus className="h-4 w-4" aria-hidden /> Añadir contacto
            </button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
