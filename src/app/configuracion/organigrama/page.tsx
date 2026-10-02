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
  foto_url: string | null;
  jefes_extra: string[];
};

type FilaPlano = Nodo & { depth: number };

/** Lee una imagen, la recorta/redimensiona a 160×160 (cover) y devuelve un data URL JPEG liviano. */
async function fileToAvatarDataUrl(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error("No se pudo leer la imagen"));
    fr.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Imagen inválida"));
    i.src = dataUrl;
  });
  const size = 160;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  const scale = Math.max(size / img.width, size / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  return canvas.toDataURL("image/jpeg", 0.82);
}

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
  const [editFoto, setEditFoto] = useState<string | null>(null);
  const [editJefesExtra, setEditJefesExtra] = useState<string[]>([]);

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
    setEditFoto(n.foto_url ?? null);
    setEditJefesExtra(Array.isArray(n.jefes_extra) ? n.jefes_extra : []);
  }

  async function onElegirFoto(file: File | null) {
    if (!file) return;
    setError(null);
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      setEditFoto(dataUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo procesar la imagen");
    }
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
          foto_url: editFoto,
          jefes_extra: editJefesExtra.filter((j) => j !== (editParent || "")),
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
                    <div className="space-y-3">
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
                    <div className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/60 p-2.5">
                      <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border-2 border-[#4FAEB2] bg-slate-100 text-slate-400">
                        {editFoto ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={editFoto} alt="foto" className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-lg">👤</span>
                        )}
                      </div>
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#4FAEB2]/30 bg-[#4FAEB2]/10 px-3 py-1.5 text-xs font-semibold text-[#3F8E91] transition-colors hover:bg-[#4FAEB2]/20">
                        {editFoto ? "Cambiar foto" : "Subir foto"}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => onElegirFoto(e.target.files?.[0] ?? null)}
                        />
                      </label>
                      {editFoto && (
                        <button
                          type="button"
                          onClick={() => setEditFoto(null)}
                          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
                        >
                          Quitar
                        </button>
                      )}
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-2.5">
                      <label className={F_LABEL}>También reporta a (doble jefatura)</label>
                      <div className="mt-1 max-h-32 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2">
                        {nodos.filter((n) => !excluir.has(n.id) && n.id !== (editParent || "")).length === 0 ? (
                          <p className="text-xs text-slate-400">No hay otros cargos para elegir.</p>
                        ) : (
                          nodos
                            .filter((n) => !excluir.has(n.id) && n.id !== (editParent || ""))
                            .sort((a, b) => a.titulo.localeCompare(b.titulo))
                            .map((o) => (
                              <label key={o.id} className="flex items-center gap-2 text-sm text-slate-700">
                                <input
                                  type="checkbox"
                                  className="h-3.5 w-3.5 accent-[#4FAEB2]"
                                  checked={editJefesExtra.includes(o.id)}
                                  onChange={(e) =>
                                    setEditJefesExtra((prev) =>
                                      e.target.checked ? [...prev, o.id] : prev.filter((x) => x !== o.id)
                                    )
                                  }
                                />
                                <span className="truncate">
                                  {o.titulo}
                                  {o.nombre_persona ? ` · ${o.nombre_persona}` : ""}
                                </span>
                              </label>
                            ))
                        )}
                      </div>
                      <p className="mt-1 text-[11px] text-slate-400">
                        Marcá otros jefes si este cargo reporta a más de uno (ej. un equipo bajo 2 jefes).
                      </p>
                    </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        {f.foto_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={f.foto_url}
                            alt=""
                            className="h-8 w-8 shrink-0 rounded-full border border-[#4FAEB2]/40 object-cover"
                          />
                        ) : null}
                        <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{f.titulo}</p>
                        <p className="truncate text-[11px] text-slate-500">
                          {f.nombre_persona ? f.nombre_persona : <span className="italic text-slate-400">Sin asignar</span>}
                          {f.parent_id && byId.get(f.parent_id) ? ` · reporta a ${byId.get(f.parent_id)!.titulo}` : ""}
                          {f.jefes_extra?.length
                            ? ` · también: ${f.jefes_extra.map((id) => byId.get(id)?.titulo).filter(Boolean).join(", ")}`
                            : ""}
                        </p>
                        </div>
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
