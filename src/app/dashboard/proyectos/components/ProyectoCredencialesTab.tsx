"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Eye, EyeOff, Pencil, Plus, Trash2, X } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import {
  credencialHref,
  type ProyectoCredencial,
} from "@/lib/proyectos/credenciales-shared";

type ApiResp<T> = { success: boolean; data?: T; error?: string };

type FormState = {
  nombre: string;
  url: string;
  usuario: string;
  password: string;
  notas: string;
};

const FORM_VACIO: FormState = { nombre: "", url: "", usuario: "", password: "", notas: "" };

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors hover:border-[#4FAEB2]/60 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20";
const labelCls = "text-xs font-medium uppercase tracking-wide text-slate-500";

/**
 * `navigator.clipboard` sólo existe en contexto seguro (https o localhost). En
 * la VPS por IP no está, así que cae al textarea + execCommand de toda la vida.
 */
async function copiarAlPortapapeles(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    // Sigue con el fallback.
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = texto;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Botón de copiar con confirmación efímera (✓ por 1.5 s). */
function CopyButton({
  value,
  label,
  onCopied,
}: {
  value: string | null | undefined;
  label: string;
  onCopied: (ok: boolean) => void;
}) {
  const [copiado, setCopiado] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const texto = (value ?? "").toString();
  const vacio = texto.length === 0;

  return (
    <button
      type="button"
      disabled={vacio}
      title={vacio ? "Sin dato para copiar" : `Copiar ${label.toLowerCase()}`}
      aria-label={`Copiar ${label.toLowerCase()}`}
      onClick={async () => {
        const ok = await copiarAlPortapapeles(texto);
        onCopied(ok);
        if (!ok) return;
        setCopiado(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopiado(false), 1500);
      }}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors ${
        copiado
          ? "text-emerald-600"
          : "text-slate-400 hover:bg-[#4FAEB2]/10 hover:text-[#3F8E91]"
      } disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-400`}
    >
      {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

/** Fila etiqueta / valor con botón de copiar al final. */
function CampoFila({
  label,
  value,
  mono,
  href,
  onCopied,
  children,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  href?: string | null;
  onCopied: (ok: boolean) => void;
  children?: React.ReactNode;
}) {
  const texto = (value ?? "").trim();
  return (
    <div className="flex items-center gap-3 border-b border-slate-100 py-2 last:border-b-0">
      <span className={`${labelCls} w-24 shrink-0`}>{label}</span>
      <div className="min-w-0 flex-1">
        {texto ? (
          href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="block truncate text-sm text-[#4FAEB2] hover:text-[#3F8E91] hover:underline"
              title={texto}
            >
              {texto}
            </a>
          ) : (
            <span
              className={`block truncate text-sm text-slate-900 ${mono ? "font-mono" : ""}`}
              title={texto}
            >
              {texto}
            </span>
          )
        ) : (
          <span className="text-sm text-slate-400">—</span>
        )}
      </div>
      {children}
      <CopyButton value={texto} label={label} onCopied={onCopied} />
    </div>
  );
}

function CredencialForm({
  form,
  setForm,
  onSubmit,
  onCancel,
  saving,
  submitLabel,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  onSubmit: () => void;
  onCancel: () => void;
  saving: boolean;
  submitLabel: string;
}) {
  const [verPass, setVerPass] = useState(true);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="cred-nombre">
            Nombre
          </label>
          <input
            id="cred-nombre"
            className={`${inputCls} mt-1.5`}
            placeholder="Ej: Hosting cPanel"
            value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            autoFocus
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="cred-url">
            URL
          </label>
          <input
            id="cred-url"
            className={`${inputCls} mt-1.5`}
            placeholder="https://panel.midominio.com"
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="cred-usuario">
            Usuario
          </label>
          <input
            id="cred-usuario"
            className={`${inputCls} mt-1.5 font-mono`}
            placeholder="usuario@dominio.com"
            value={form.usuario}
            onChange={(e) => setForm({ ...form, usuario: e.target.value })}
            autoComplete="off"
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="cred-password">
            Contraseña
          </label>
          <div className="relative mt-1.5">
            <input
              id="cred-password"
              type={verPass ? "text" : "password"}
              className={`${inputCls} pr-10 font-mono`}
              placeholder="••••••••"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setVerPass((v) => !v)}
              aria-label={verPass ? "Ocultar contraseña" : "Mostrar contraseña"}
              className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              {verPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
      <div>
        <label className={labelCls} htmlFor="cred-notas">
          Notas
        </label>
        <textarea
          id="cred-notas"
          rows={2}
          className={`${inputCls} mt-1.5`}
          placeholder="Opcional: 2FA, IP permitida, quién la administra…"
          value={form.notas}
          onChange={(e) => setForm({ ...form, notas: e.target.value })}
        />
      </div>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={saving || !form.nombre.trim()}
          className="rounded-xl bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#3F8E91] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
        >
          {saving ? "Guardando…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

export default function ProyectoCredencialesTab({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<ProyectoCredencial[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [creando, setCreando] = useState(false);
  const [form, setForm] = useState<FormState>(FORM_VACIO);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(FORM_VACIO);
  const [saving, setSaving] = useState(false);
  const [borrandoId, setBorrandoId] = useState<string | null>(null);
  const [visibles, setVisibles] = useState<Set<string>>(() => new Set());

  const cargar = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const res = await fetchWithSupabaseSession(`/api/proyectos/${projectId}/credenciales`, {
      cache: "no-store",
    });
    const j = (await res.json().catch(() => null)) as ApiResp<ProyectoCredencial[]> | null;
    if (!res.ok || !j?.success || !j.data) {
      setErr(j?.error ?? "Error al cargar las credenciales");
      setLoading(false);
      return;
    }
    setErr(null);
    setItems(j.data);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // El aviso de copiado/error se limpia solo para no quedar pegado en pantalla.
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 2500);
    return () => clearTimeout(t);
  }, [aviso]);

  const onCopied = useCallback((ok: boolean) => {
    setAviso(ok ? "Copiado al portapapeles" : "No se pudo copiar. Copialo a mano.");
  }, []);

  async function crear() {
    if (!form.nombre.trim()) return;
    setSaving(true);
    const res = await fetchWithSupabaseSession(`/api/proyectos/${projectId}/credenciales`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const j = (await res.json().catch(() => null)) as ApiResp<ProyectoCredencial> | null;
    setSaving(false);
    if (!res.ok || !j?.success || !j.data) {
      setErr(j?.error ?? "No se pudo guardar la credencial");
      return;
    }
    setErr(null);
    setItems((prev) => [...prev, j.data as ProyectoCredencial]);
    setForm(FORM_VACIO);
    setCreando(false);
  }

  function iniciarEdicion(c: ProyectoCredencial) {
    setEditandoId(c.id);
    setEditForm({
      nombre: c.nombre ?? "",
      url: c.url ?? "",
      usuario: c.usuario ?? "",
      password: c.password ?? "",
      notas: c.notas ?? "",
    });
  }

  async function guardarEdicion(cid: string) {
    if (!editForm.nombre.trim()) return;
    setSaving(true);
    const res = await fetchWithSupabaseSession(
      `/api/proyectos/${projectId}/credenciales/${cid}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      }
    );
    const j = (await res.json().catch(() => null)) as ApiResp<ProyectoCredencial> | null;
    setSaving(false);
    if (!res.ok || !j?.success || !j.data) {
      setErr(j?.error ?? "No se pudo actualizar la credencial");
      return;
    }
    setErr(null);
    const row = j.data;
    setItems((prev) => prev.map((it) => (it.id === cid ? row : it)));
    setEditandoId(null);
  }

  async function eliminar(cid: string, nombre: string) {
    if (!window.confirm(`¿Eliminar el grupo de credenciales "${nombre}"?`)) return;
    setBorrandoId(cid);
    const res = await fetchWithSupabaseSession(
      `/api/proyectos/${projectId}/credenciales/${cid}`,
      { method: "DELETE" }
    );
    const j = (await res.json().catch(() => null)) as ApiResp<{ id: string }> | null;
    setBorrandoId(null);
    if (!res.ok || !j?.success) {
      setErr(j?.error ?? "No se pudo eliminar la credencial");
      return;
    }
    setErr(null);
    setItems((prev) => prev.filter((it) => it.id !== cid));
  }

  function toggleVisible(cid: string) {
    setVisibles((prev) => {
      const next = new Set(prev);
      if (next.has(cid)) next.delete(cid);
      else next.add(cid);
      return next;
    });
  }

  const panelCls =
    "rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="h-5 w-1 rounded-full bg-[#4FAEB2]" />
          <h2 className="text-sm font-semibold text-slate-900">Credenciales del proyecto</h2>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600">
            {items.length}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {aviso ? (
            <span className="text-xs font-medium text-slate-500">{aviso}</span>
          ) : null}
          {!creando ? (
            <button
              type="button"
              onClick={() => {
                setForm(FORM_VACIO);
                setCreando(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#4FAEB2] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#3F8E91]"
            >
              <Plus className="h-4 w-4" />
              Nuevo grupo
            </button>
          ) : null}
        </div>
      </div>

      {err ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-sm text-amber-900">
          {err}
        </div>
      ) : null}

      {creando ? (
        <div className={panelCls}>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Nuevo grupo de credenciales</h3>
            <button
              type="button"
              onClick={() => setCreando(false)}
              aria-label="Cerrar"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <CredencialForm
            form={form}
            setForm={setForm}
            onSubmit={() => void crear()}
            onCancel={() => setCreando(false)}
            saving={saving}
            submitLabel="Guardar"
          />
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          Cargando…
        </div>
      ) : items.length === 0 && !creando ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          Todavía no hay credenciales cargadas para este proyecto.
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {items.map((c) => {
          const enEdicion = editandoId === c.id;
          const passVisible = visibles.has(c.id);
          const pass = c.password ?? "";
          return (
            <div key={c.id} className={panelCls}>
              {enEdicion ? (
                <CredencialForm
                  form={editForm}
                  setForm={setEditForm}
                  onSubmit={() => void guardarEdicion(c.id)}
                  onCancel={() => setEditandoId(null)}
                  saving={saving}
                  submitLabel="Guardar cambios"
                />
              ) : (
                <>
                  <div className="flex items-start gap-2">
                    <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
                      {c.nombre}
                    </h3>
                    <button
                      type="button"
                      onClick={() => iniciarEdicion(c)}
                      aria-label="Editar credencial"
                      title="Editar"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-[#4FAEB2]/10 hover:text-[#3F8E91]"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void eliminar(c.id, c.nombre)}
                      disabled={borrandoId === c.id}
                      aria-label="Eliminar credencial"
                      title="Eliminar"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="mt-2">
                    <CampoFila
                      label="Nombre"
                      value={c.nombre}
                      onCopied={onCopied}
                    />
                    <CampoFila
                      label="URL"
                      value={c.url}
                      href={credencialHref(c.url)}
                      onCopied={onCopied}
                    />
                    <CampoFila
                      label="Usuario"
                      value={c.usuario}
                      mono
                      onCopied={onCopied}
                    />
                    {/* La contraseña se copia siempre en claro aunque esté oculta. */}
                    <div className="flex items-center gap-3 border-b border-slate-100 py-2 last:border-b-0">
                      <span className={`${labelCls} w-24 shrink-0`}>Contraseña</span>
                      <div className="min-w-0 flex-1">
                        {pass ? (
                          <span className="block truncate font-mono text-sm text-slate-900">
                            {passVisible ? pass : "•".repeat(Math.min(pass.length, 16))}
                          </span>
                        ) : (
                          <span className="text-sm text-slate-400">—</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleVisible(c.id)}
                        disabled={!pass}
                        aria-label={passVisible ? "Ocultar contraseña" : "Mostrar contraseña"}
                        title={passVisible ? "Ocultar" : "Mostrar"}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {passVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                      <CopyButton value={pass} label="Contraseña" onCopied={onCopied} />
                    </div>
                  </div>

                  {c.notas ? (
                    <p className="mt-3 whitespace-pre-line break-words text-xs leading-relaxed text-slate-500">
                      {c.notas}
                    </p>
                  ) : null}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
