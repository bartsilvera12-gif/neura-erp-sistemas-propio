"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, History, Loader2, Plus, Save, Trash2 } from "lucide-react";
import EditorTexto from "@/components/ayuda/EditorTexto";
import AdjuntosEditor from "@/components/ayuda/AdjuntosEditor";
import { F_INPUT, F_LABEL, F_SELECT } from "@/components/config/global-config-primitives";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import {
  MODULOS_AYUDA,
  rolLabel,
  type AyudaArticulo,
  type AyudaCategoria,
  type AyudaVersion,
} from "./types";

type Props = {
  /** `null` = artículo nuevo. */
  articulo: AyudaArticulo | null;
  categorias: AyudaCategoria[];
  rolesDisponibles: string[];
  onClose: () => void;
  /** Se llama tras guardar/eliminar para que la lista se refresque. */
  onSaved: () => void;
};

type FormState = {
  titulo: string;
  resumen: string;
  categoria_id: string;
  modulo: string;
  roles_visibles: string[];
  orden: number;
  publicado: boolean;
  contenido_md: string;
};

function initialForm(a: AyudaArticulo | null): FormState {
  return {
    titulo: a?.titulo ?? "",
    resumen: a?.resumen ?? "",
    categoria_id: a?.categoria_id ?? "",
    modulo: a?.modulo ?? "",
    roles_visibles: a?.roles_visibles ?? [],
    orden: a?.orden ?? 0,
    publicado: a?.publicado ?? false,
    contenido_md: a?.contenido_md ?? "",
  };
}

export default function AyudaArticuloEditor({
  articulo,
  categorias,
  rolesDisponibles,
  onClose,
  onSaved,
}: Props) {
  const [form, setForm] = useState<FormState>(() => initialForm(articulo));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nuevaCategoria, setNuevaCategoria] = useState("");
  const [creandoCategoria, setCreandoCategoria] = useState(false);
  const [categoriasLocal, setCategoriasLocal] = useState<AyudaCategoria[]>(categorias);
  const [versiones, setVersiones] = useState<AyudaVersion[] | null>(null);
  const [cargandoVersiones, setCargandoVersiones] = useState(false);

  useEffect(() => {
    setForm(initialForm(articulo));
    setVersiones(null);
    setError(null);
  }, [articulo]);

  useEffect(() => {
    setCategoriasLocal(categorias);
  }, [categorias]);

  const set = useCallback(<K extends keyof FormState>(key: K, val: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: val }));
  }, []);

  const toggleRol = useCallback((rol: string) => {
    setForm((f) => ({
      ...f,
      roles_visibles: f.roles_visibles.includes(rol)
        ? f.roles_visibles.filter((r) => r !== rol)
        : [...f.roles_visibles, rol],
    }));
  }, []);

  const visibilidadTexto = useMemo(() => {
    if (form.roles_visibles.length === 0) return "Lo ve todo el equipo.";
    return `Solo lo ven: ${form.roles_visibles.map(rolLabel).join(", ")} (y los administradores).`;
  }, [form.roles_visibles]);

  const crearCategoria = useCallback(async () => {
    const nombre = nuevaCategoria.trim();
    if (!nombre) return;
    setCreandoCategoria(true);
    setError(null);
    try {
      const r = await apiFetch("/api/configuracion/ayuda/categorias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setError(j?.error ?? `Error ${r.status}`);
        return;
      }
      const cat = j.data.categoria as AyudaCategoria;
      setCategoriasLocal((cs) => (cs.some((c) => c.id === cat.id) ? cs : [...cs, cat]));
      set("categoria_id", cat.id);
      setNuevaCategoria("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setCreandoCategoria(false);
    }
  }, [nuevaCategoria, set]);

  const guardar = useCallback(
    async (publicar?: boolean) => {
      if (!form.titulo.trim()) {
        setError("Poné un título antes de guardar.");
        return;
      }
      setSaving(true);
      setError(null);
      const payload = {
        titulo: form.titulo.trim(),
        resumen: form.resumen.trim() || null,
        categoria_id: form.categoria_id || null,
        modulo: form.modulo || null,
        roles_visibles: form.roles_visibles,
        orden: form.orden,
        publicado: publicar ?? form.publicado,
        contenido_md: form.contenido_md,
      };
      try {
        const r = await apiFetch(
          articulo ? `/api/configuracion/ayuda/${articulo.id}` : "/api/configuracion/ayuda",
          {
            method: articulo ? "PATCH" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }
        );
        const j = await r.json();
        if (!r.ok || !j?.success) {
          setError(j?.error ?? `Error ${r.status}`);
          return;
        }
        onSaved();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error de red");
      } finally {
        setSaving(false);
      }
    },
    [articulo, form, onSaved]
  );

  const eliminar = useCallback(async () => {
    if (!articulo) return;
    if (!window.confirm(`¿Eliminar "${articulo.titulo}"? Esta acción no se puede deshacer.`)) return;
    setSaving(true);
    setError(null);
    try {
      const r = await apiFetch(`/api/configuracion/ayuda/${articulo.id}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setError(j?.error ?? `Error ${r.status}`);
        return;
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setSaving(false);
    }
  }, [articulo, onSaved]);

  const cargarVersiones = useCallback(async () => {
    if (!articulo) return;
    setCargandoVersiones(true);
    try {
      const r = await apiFetch(`/api/configuracion/ayuda/${articulo.id}/versiones`);
      const j = await r.json();
      if (r.ok && j?.success) setVersiones(j.data.versiones as AyudaVersion[]);
      else setError(j?.error ?? `Error ${r.status}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setCargandoVersiones(false);
    }
  }, [articulo]);

  return (
    <div className="space-y-5">
      {/* Encabezado del editor */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-[#4FAEB2]/60 hover:bg-[#4FAEB2]/5"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver a la lista
        </button>

        <div className="flex flex-wrap items-center gap-2">
          {articulo && (
            <>
              <button
                type="button"
                onClick={cargarVersiones}
                disabled={cargandoVersiones}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
              >
                {cargandoVersiones ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <History className="h-4 w-4" />
                )}
                Historial
              </button>
              <button
                type="button"
                onClick={eliminar}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 shadow-sm transition-colors hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                Eliminar
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => guardar(false)}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Guardar borrador
          </button>
          <button
            type="button"
            onClick={() => guardar(true)}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#3F8E91] disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {form.publicado ? "Guardar y publicar" : "Publicar"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Datos del artículo */}
      <div className="grid grid-cols-1 gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:grid-cols-2">
        <div className="lg:col-span-2">
          <label className={F_LABEL}>Título</label>
          <input
            className={F_INPUT}
            value={form.titulo}
            onChange={(e) => set("titulo", e.target.value)}
            placeholder="Ej.: Cómo cargar un cliente nuevo"
          />
        </div>

        <div className="lg:col-span-2">
          <label className={F_LABEL}>Resumen (opcional)</label>
          <input
            className={F_INPUT}
            value={form.resumen}
            onChange={(e) => set("resumen", e.target.value)}
            placeholder="Una línea que explique de qué se trata. Se muestra en el listado."
          />
        </div>

        <div>
          <label className={F_LABEL}>Categoría</label>
          <select
            className={F_SELECT}
            value={form.categoria_id}
            onChange={(e) => set("categoria_id", e.target.value)}
          >
            <option value="">— Sin categoría —</option>
            {categoriasLocal.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
          <div className="mt-2 flex gap-2">
            <input
              className={F_INPUT}
              value={nuevaCategoria}
              onChange={(e) => setNuevaCategoria(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  crearCategoria();
                }
              }}
              placeholder="Crear una categoría nueva…"
            />
            <button
              type="button"
              onClick={crearCategoria}
              disabled={creandoCategoria || !nuevaCategoria.trim()}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40"
            >
              {creandoCategoria ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div>
          <label className={F_LABEL}>Módulo del ERP</label>
          <select className={F_SELECT} value={form.modulo} onChange={(e) => set("modulo", e.target.value)}>
            {MODULOS_AYUDA.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
            Si lo asociás a un módulo, el artículo aparece agrupado bajo esa pantalla en la Ayuda.
          </p>
        </div>

        <div className="lg:col-span-2">
          <label className={F_LABEL}>Quién puede verlo</label>
          <div className="flex flex-wrap gap-2">
            {rolesDisponibles.length === 0 && (
              <span className="text-sm text-slate-400">No se detectaron roles cargados en la empresa.</span>
            )}
            {rolesDisponibles.map((rol) => {
              const activo = form.roles_visibles.includes(rol);
              return (
                <button
                  key={rol}
                  type="button"
                  onClick={() => toggleRol(rol)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    activo
                      ? "border-[#4FAEB2] bg-[#4FAEB2]/10 text-[#3F8E91]"
                      : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  {rolLabel(rol)}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
            {visibilidadTexto} Sin ninguno marcado, el artículo es para todos.
          </p>
        </div>

        <div>
          <label className={F_LABEL}>Orden en el listado</label>
          <input
            type="number"
            className={F_INPUT}
            value={form.orden}
            onChange={(e) => set("orden", Number(e.target.value) || 0)}
          />
          <p className="mt-1.5 text-xs text-slate-400">Menor número = aparece más arriba.</p>
        </div>

        <div className="flex items-end">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.publicado}
              onChange={(e) => set("publicado", e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-[#4FAEB2] focus:ring-[#4FAEB2]"
            />
            Publicado (visible para el equipo)
          </label>
        </div>
      </div>

      {/* Contenido */}
      <div>
        <label className={F_LABEL}>Contenido</label>
        <EditorTexto value={form.contenido_md} onChange={(v) => set("contenido_md", v)} />
      </div>

      {/* Documentos adjuntos — requieren un artículo ya guardado */}
      {articulo ? (
        <AdjuntosEditor articuloId={articulo.id} />
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500">
          Guardá el artículo primero y vas a poder adjuntar documentos (contrato en PDF, planillas, etc.).
        </div>
      )}

      {/* Historial */}
      {versiones && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">
            Versiones anteriores
          </h4>
          {versiones.length === 0 ? (
            <p className="text-sm text-slate-400">Todavía no hay ediciones guardadas.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {versiones.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-700">{v.titulo}</p>
                    <p className="text-xs text-slate-400">
                      {new Date(v.created_at).toLocaleString("es-PY")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      set("titulo", v.titulo);
                      set("contenido_md", v.contenido_md);
                    }}
                    className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
                  >
                    Cargar esta versión
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-slate-400">
            &quot;Cargar esta versión&quot; trae el texto al editor; recién se aplica cuando guardás.
          </p>
        </div>
      )}
    </div>
  );
}
