"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GlobalConfigSubpageShell } from "@/components/config/GlobalConfigSubpageShell";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";

type Nodo = {
  id: string;
  parent_id: string | null;
  titulo: string;
  nombre_persona: string | null;
  orden: number;
  color: string | null;
};

type FilaPlano = Nodo & { depth: number };

const F_INPUT =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/30";
const F_LABEL = "block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 mb-1";

function aplanar(nodos: Nodo[]): FilaPlano[] {
  const childrenByParent = new Map<string | null, Nodo[]>();
  for (const n of nodos) {
    const k = n.parent_id ?? null;
    if (!childrenByParent.has(k)) childrenByParent.set(k, []);
    childrenByParent.get(k)!.push(n);
  }
  for (const arr of childrenByParent.values()) {
    arr.sort((a, b) => a.orden - b.orden || a.titulo.localeCompare(b.titulo));
  }
  const out: FilaPlano[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const n of childrenByParent.get(parent) ?? []) {
      out.push({ ...n, depth });
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** ids del subárbol de `rootId` (incluido) — para no ofrecerlos como "jefe" (evita ciclos). */
function descendientesIncluido(rootId: string, nodos: Nodo[]): Set<string> {
  const childrenByParent = new Map<string | null, Nodo[]>();
  for (const n of nodos) {
    const k = n.parent_id ?? null;
    if (!childrenByParent.has(k)) childrenByParent.set(k, []);
    childrenByParent.get(k)!.push(n);
  }
  const set = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const c of childrenByParent.get(cur) ?? []) {
      if (!set.has(c.id)) {
        set.add(c.id);
        stack.push(c.id);
      }
    }
  }
  return set;
}

export default function ConfigOrganigramaPage() {
  const [nodos, setNodos] = useState<Nodo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // Alta
  const [nuevoTitulo, setNuevoTitulo] = useState("");
  const [nuevaPersona, setNuevaPersona] = useState("");
  const [nuevoParent, setNuevoParent] = useState<string>("");

  // Edición inline
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitulo, setEditTitulo] = useState("");
  const [editPersona, setEditPersona] = useState("");
  const [editParent, setEditParent] = useState<string>("");

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await apiFetch("/api/organigrama", { cache: "no-store" });
      const json = await res.json();
      if (!json?.success) throw new Error(json?.error ?? "No se pudo cargar el organigrama");
      setNodos((json.data?.nodos ?? []) as Nodo[]);
      setCanEdit(Boolean(json.data?.meta?.can_edit));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const filas = useMemo(() => aplanar(nodos), [nodos]);
  const byId = useMemo(() => new Map(nodos.map((n) => [n.id, n])), [nodos]);

  async function agregar() {
    const titulo = nuevoTitulo.trim();
    if (!titulo) return;
    setGuardando(true);
    setError(null);
    try {
      const res = await apiFetch("/api/organigrama", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo,
          nombre_persona: nuevaPersona.trim() || null,
          parent_id: nuevoParent || null,
        }),
      });
      const json = await res.json();
      if (!json?.success) throw new Error(json?.error ?? "No se pudo crear el cargo");
      setNuevoTitulo("");
      setNuevaPersona("");
      setNuevoParent("");
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al crear");
    } finally {
      setGuardando(false);
    }
  }

  function abrirEdicion(n: Nodo) {
    setEditId(n.id);
    setEditTitulo(n.titulo);
    setEditPersona(n.nombre_persona ?? "");
    setEditParent(n.parent_id ?? "");
  }

  async function guardarEdicion() {
    if (!editId) return;
    const titulo = editTitulo.trim();
    if (!titulo) return;
    setGuardando(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/organigrama/${editId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo,
          nombre_persona: editPersona.trim() || null,
          parent_id: editParent || null,
        }),
      });
      const json = await res.json();
      if (!json?.success) throw new Error(json?.error ?? "No se pudo guardar");
      setEditId(null);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(n: Nodo) {
    if (!confirm(`¿Borrar el cargo "${n.titulo}"? Sus subordinados quedarán colgando del jefe superior.`)) return;
    setGuardando(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/organigrama/${n.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json?.success) throw new Error(json?.error ?? "No se pudo borrar");
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al borrar");
    } finally {
      setGuardando(false);
    }
  }

  const opcionesJefe = (excluir?: Set<string>) =>
    nodos
      .filter((n) => !excluir?.has(n.id))
      .sort((a, b) => a.titulo.localeCompare(b.titulo))
      .map((n) => (
        <option key={n.id} value={n.id}>
          {n.titulo}
        </option>
      ));

  return (
    <GlobalConfigSubpageShell
      eyebrow="Empresa"
      title="Organigrama"
      description="Armá la estructura de cargos: quién reporta a quién. Se muestra en el módulo Organigrama."
    >
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      {!cargando && !canEdit && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Solo un administrador puede editar el organigrama. Podés verlo en el módulo Organigrama.
        </div>
      )}

      {/* Alta */}
      {canEdit && (
        <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-bold text-slate-900">Agregar cargo</h2>
          <div className="grid gap-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
            <div>
              <label className={F_LABEL}>Cargo *</label>
              <input
                className={F_INPUT}
                value={nuevoTitulo}
                onChange={(e) => setNuevoTitulo(e.target.value)}
                placeholder="Ej: Jefe de Ventas"
                onKeyDown={(e) => e.key === "Enter" && agregar()}
              />
            </div>
            <div>
              <label className={F_LABEL}>Persona (opcional)</label>
              <input
                className={F_INPUT}
                value={nuevaPersona}
                onChange={(e) => setNuevaPersona(e.target.value)}
                placeholder="Ej: Juan Pérez"
                onKeyDown={(e) => e.key === "Enter" && agregar()}
              />
            </div>
            <div>
              <label className={F_LABEL}>Reporta a</label>
              <select className={F_INPUT} value={nuevoParent} onChange={(e) => setNuevoParent(e.target.value)}>
                <option value="">— Sin jefe (nivel más alto) —</option>
                {opcionesJefe()}
              </select>
            </div>
            <button
              type="button"
              onClick={agregar}
              disabled={guardando || !nuevoTitulo.trim()}
              className="h-[38px] rounded-lg bg-[#4FAEB2] px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#3F8E91] disabled:opacity-50"
            >
              Agregar
            </button>
          </div>
        </section>
      )}

      {/* Árbol */}
      <section className="rounded-2xl border border-slate-100 bg-white p-2 shadow-sm sm:p-4">
        {cargando ? (
          <p className="py-10 text-center text-sm text-slate-400">Cargando…</p>
        ) : filas.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">Todavía no hay cargos cargados.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filas.map((f) => {
              const enEdicion = editId === f.id;
              const excluir = descendientesIncluido(f.id, nodos);
              return (
                <li key={f.id} className="py-2.5" style={{ paddingLeft: `${f.depth * 22}px` }}>
                  {enEdicion ? (
                    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
                      <div>
                        <label className={F_LABEL}>Cargo</label>
                        <input className={F_INPUT} value={editTitulo} onChange={(e) => setEditTitulo(e.target.value)} />
                      </div>
                      <div>
                        <label className={F_LABEL}>Persona</label>
                        <input className={F_INPUT} value={editPersona} onChange={(e) => setEditPersona(e.target.value)} />
                      </div>
                      <div>
                        <label className={F_LABEL}>Reporta a</label>
                        <select className={F_INPUT} value={editParent} onChange={(e) => setEditParent(e.target.value)}>
                          <option value="">— Sin jefe (nivel más alto) —</option>
                          {opcionesJefe(excluir)}
                        </select>
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={guardarEdicion}
                          disabled={guardando}
                          className="h-[38px] rounded-lg bg-[#4FAEB2] px-3 text-xs font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50"
                        >
                          Guardar
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditId(null)}
                          className="h-[38px] rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{f.titulo}</p>
                        <p className="truncate text-[11px] text-slate-500">
                          {f.nombre_persona ? f.nombre_persona : <span className="italic text-slate-400">Sin asignar</span>}
                          {f.parent_id && byId.get(f.parent_id) ? ` · reporta a ${byId.get(f.parent_id)!.titulo}` : ""}
                        </p>
                      </div>
                      {canEdit && (
                        <div className="flex shrink-0 gap-1.5">
                          <button
                            type="button"
                            onClick={() => abrirEdicion(f)}
                            className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition-colors hover:border-[#4FAEB2]/40 hover:text-[#3F8E91]"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => borrar(f)}
                            className="rounded-lg border border-red-200 px-2.5 py-1 text-[11px] font-semibold text-red-500 transition-colors hover:bg-red-50"
                          >
                            Borrar
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </GlobalConfigSubpageShell>
  );
}
