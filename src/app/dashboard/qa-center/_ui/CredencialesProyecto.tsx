"use client";

/**
 * NEURA QA CENTER — gestión de credenciales QA por proyecto.
 *
 * Lista las credenciales (solo máscaras), permite agregar nuevas y desactivar.
 * NUNCA muestra el password real: el usuario tipea el password que quiere
 * guardar, se cifra server-side y a partir de ahí solo se ve una máscara.
 */

import { useCallback, useEffect, useState } from "react";

type CredencialMascara = {
  id: string;
  label: string;
  rol: "lectura_autenticada" | "sandbox_interactivo";
  email_mascara: string;
  password_mascara: string;
  active: boolean;
  created_at: string;
  last_used_at: string | null;
  updated_at: string;
};

type Props = {
  projectId: string;
};

const ROLES: Array<{
  value: CredencialMascara["rol"];
  label: string;
  descripcion: string;
}> = [
  {
    value: "lectura_autenticada",
    label: "Lectura autenticada",
    descripcion:
      "Usuario QA de solo-lectura. El runner solo hace GET/SELECT; nunca POST.",
  },
  {
    value: "sandbox_interactivo",
    label: "Sandbox interactivo",
    descripcion:
      "Usuario QA para pruebas interactivas en sandbox verificado (crea/edita datos ficticios en clon aislado).",
  },
];

export default function CredencialesProyecto({ projectId }: Props) {
  const [creds, setCreds] = useState<CredencialMascara[]>([]);
  const [cargando, setCargando] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [label, setLabel] = useState("");
  const [rol, setRol] = useState<CredencialMascara["rol"]>("lectura_autenticada");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notas, setNotas] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [mostrarPass, setMostrarPass] = useState(false);

  const cargar = useCallback(async (): Promise<void> => {
    setCargando(true);
    setErr(null);
    try {
      const res = await fetch(`/api/qa/projects/${projectId}/credenciales`, {
        cache: "no-store",
      });
      const json = (await res.json()) as {
        data?: CredencialMascara[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setCreds(json.data ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error cargando credenciales");
    } finally {
      setCargando(false);
    }
  }, [projectId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const resetForm = (): void => {
    setLabel("");
    setEmail("");
    setPassword("");
    setNotas("");
    setRol("lectura_autenticada");
    setMostrarPass(false);
  };

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!label.match(/^[a-z][a-z0-9_]{0,40}$/)) {
      setErr("label debe empezar con letra, solo a-z0-9_");
      return;
    }
    setGuardando(true);
    setErr(null);
    try {
      const res = await fetch(`/api/qa/projects/${projectId}/credenciales`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, rol, email, password, notas: notas.trim() || undefined }),
      });
      const json = (await res.json()) as {
        data?: CredencialMascara;
        error?: string;
        field?: string;
      };
      if (!res.ok) throw new Error(`${json.error ?? "error"}${json.field ? ` (${json.field})` : ""}`);
      resetForm();
      await cargar();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error guardando");
    } finally {
      setGuardando(false);
    }
  };

  const desactivar = async (credId: string): Promise<void> => {
    if (!confirm("Desactivar esta credencial? Queda inaccesible al runner, pero se mantiene el historial.")) return;
    try {
      const res = await fetch(
        `/api/qa/projects/${projectId}/credenciales?cred_id=${encodeURIComponent(credId)}`,
        { method: "DELETE" }
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      await cargar();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error al desactivar");
    }
  };

  return (
    <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
      <header className="mb-3">
        <h2 className="text-base font-semibold text-slate-900">Credenciales QA</h2>
        <p className="text-xs text-slate-500">
          Usuarios de prueba que el runner usará para este proyecto. El password
          se cifra server-side y nunca vuelve a mostrarse.
        </p>
      </header>

      {err && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          {err}
        </div>
      )}

      <form onSubmit={submit} className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-5">
        <label className="md:col-span-1">
          <span className="mb-1 block text-xs font-medium text-slate-700">Label</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value.toLowerCase())}
            placeholder="qa_lectura"
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
            required
            pattern="^[a-z][a-z0-9_]{0,40}$"
            title="Solo a-z 0-9 _ (empezar con letra)"
          />
        </label>
        <label className="md:col-span-2">
          <span className="mb-1 block text-xs font-medium text-slate-700">Rol</span>
          <select
            value={rol}
            onChange={(e) => setRol(e.target.value as CredencialMascara["rol"])}
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[10px] text-slate-500">
            {ROLES.find((r) => r.value === rol)?.descripcion}
          </p>
        </label>
        <label className="md:col-span-2">
          <span className="mb-1 block text-xs font-medium text-slate-700">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="qa+lectura@empresa.com"
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
            required
            autoComplete="off"
          />
        </label>
        <label className="md:col-span-2">
          <span className="mb-1 block text-xs font-medium text-slate-700">Password</span>
          <div className="flex gap-1">
            <input
              type={mostrarPass ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              required
              minLength={4}
              maxLength={256}
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setMostrarPass((v) => !v)}
              className="rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-600"
            >
              {mostrarPass ? "ocultar" : "mostrar"}
            </button>
          </div>
        </label>
        <label className="md:col-span-2">
          <span className="mb-1 block text-xs font-medium text-slate-700">Notas (opcional)</span>
          <input
            type="text"
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="ej. cuenta compartida con el equipo"
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <div className="md:col-span-1 flex items-end">
          <button
            type="submit"
            disabled={guardando}
            className="w-full rounded-md bg-sky-600 px-3 py-1 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>

      {cargando ? (
        <p className="text-xs text-slate-500">Cargando…</p>
      ) : creds.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-4 text-center text-xs text-slate-500">
          Sin credenciales registradas. Agregá una arriba para que el runner pueda autenticarse.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
          {creds.map((c) => (
            <li key={c.id} className={`grid grid-cols-6 gap-2 px-3 py-2 text-xs ${c.active ? "" : "opacity-50"}`}>
              <div className="col-span-1 font-mono text-slate-700">{c.label}</div>
              <div className="col-span-1 text-slate-600">{ROLES.find((r) => r.value === c.rol)?.label ?? c.rol}</div>
              <div className="col-span-2 font-mono text-slate-700">{c.email_mascara}</div>
              <div className="col-span-1 font-mono tracking-widest text-slate-500">{c.password_mascara}</div>
              <div className="col-span-1 flex items-center justify-end gap-2">
                {!c.active && <span className="rounded bg-slate-200 px-1 text-[10px] text-slate-700">inactiva</span>}
                {c.active && (
                  <button
                    onClick={() => void desactivar(c.id)}
                    className="rounded border border-red-200 px-2 py-0.5 text-[11px] text-red-700 hover:bg-red-50"
                  >
                    Desactivar
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
