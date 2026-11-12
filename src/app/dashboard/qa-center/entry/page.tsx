"use client";

/**
 * NEURA QA CENTER — puerta de entrada local.
 *
 * Alternativa aditiva a `/login` para flujos donde el redirect por default del
 * ERP (`router.push("/")` + AuthGuard que exige módulos) no está disponible
 * porque el entorno local no configuró SUPABASE_SERVICE_ROLE_KEY.
 *
 * Esta página hace exactamente lo mismo que `/login` a nivel auth, pero al
 * terminar redirige DIRECTO a `/dashboard/qa-center` en lugar de pasar por `/`.
 * No modifica ni importa nada del flujo del ERP; sólo reusa `signIn` de la lib
 * de auth existente.
 *
 * No destinada a producción. En un deploy con SERVICE_ROLE_KEY completo, el
 * flujo recomendado sigue siendo `/login`.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { signIn } from "@/lib/auth";

export default function QaCenterEntryPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: authError } = await signIn(email, password);

    setLoading(false);

    if (authError) {
      const msg = authError.message || "Credenciales incorrectas.";
      if (msg.includes("Invalid login credentials") || msg.includes("invalid_credentials")) {
        setError("Credenciales incorrectas. Verificá tu email y contraseña.");
      } else {
        setError(msg);
      }
      return;
    }

    // DIRECTO al panel QA Center — bypassa `/` y su AuthGuard.
    router.push("/dashboard/qa-center");
  };

  return (
    <div className="flex min-h-dvh w-full flex-col items-center justify-center bg-slate-900 px-4 py-6">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white p-6 shadow-xl">
        <h1 className="mb-1 text-xl font-semibold text-slate-900">QA Center</h1>
        <p className="mb-5 text-xs text-slate-500">
          Entrada directa para validación local. Se salta la home del ERP.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-700">Correo electrónico</span>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="usuario@empresa.com"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-slate-700">Contraseña</span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
            />
          </label>

          {error && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-sky-600 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-60"
          >
            {loading ? "Entrando…" : "Entrar al panel"}
          </button>
        </form>
      </div>
    </div>
  );
}
