"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import { signIn } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** null = todavía no se sabe (primer render, igual en servidor y navegador). */
  const [esApp, setEsApp] = useState<boolean | null>(null);
  useEffect(() => {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    setEsApp(typeof cap?.isNativePlatform === "function" && cap.isNativePlatform() === true);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: authError } = await signIn(email, password);

    setLoading(false);

    if (authError) {
      const msg = authError.message || "Credenciales incorrectas.";
      if (msg.includes("Invalid login credentials") || msg.includes("invalid_credentials")) {
        setError("Credenciales incorrectas. Verificá tu email y contraseña.");
      } else if (msg.includes("Email not confirmed")) {
        setError("Tu email no está confirmado. Revisá tu bandeja de entrada o contactá al administrador.");
      } else if (msg.includes("user_banned") || msg.includes("User is banned")) {
        setError("Tu cuenta está desactivada. Contactá al administrador.");
      } else {
        setError(msg);
      }
      return;
    }

    // Dentro de la APK (Capacitor nativo) el asesor va directo a su vista móvil: "/" exige
    // el módulo dashboard, que este usuario no tiene, y AuthGuard lo rebota al login (loop).
    // En navegador/desktop se mantiene exactamente el destino de siempre ("/").
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor?.isNativePlatform?.()) {
      router.push("/m/asesor");
    } else {
      router.push("/");
    }
  }

  // La app Zentra (Capacitor) conserva su login de siempre: el diseño nuevo es solo para la web.
  // Hasta saber dónde corre no se dibuja nada, para que en la app no parpadee el diseño web.
  if (esApp === null) return <div className="min-h-dvh bg-white" />;

  if (esApp) {
    return (
      <div className="zentra-login-bg flex min-h-dvh w-full flex-col items-center justify-center overflow-x-hidden overflow-y-auto px-4 py-5 md:h-dvh md:overflow-y-hidden md:py-6">
        <div className="flex w-full max-w-[22rem] shrink-0 flex-col items-center gap-3 sm:max-w-sm sm:gap-4">
          <div className="w-full max-w-[13.5rem] shrink-0 sm:max-w-[15rem]">
            <Image
              src="/brand/zentra-logo-official.png"
              alt="ZENTRA"
              width={480}
              height={264}
              priority
              className="h-auto w-full max-h-[4.25rem] object-contain object-center sm:max-h-[4.75rem]"
            />
          </div>

          <p className="text-center text-sm text-sky-100/90">Iniciá sesión para continuar</p>

          <div className="w-full rounded-2xl border border-white/20 bg-white/[0.97] p-5 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.38)] backdrop-blur-md sm:p-6">
            <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5" autoComplete="off">
              {/*
                Señuelos anti-autofill: algunos navegadores ignoran autoComplete="off"
                en formularios de login y rellenan el primer par usuario/contraseña que
                encuentran. Estos campos ocultos (fuera de pantalla, no display:none para
                que el navegador los considere "reales") capturan ese autofill en lugar de
                los campos visibles. No tienen estado ni participan del submit.
              */}
              <div
                aria-hidden="true"
                style={{ position: "absolute", height: 0, width: 0, overflow: "hidden", opacity: 0, pointerEvents: "none" }}
              >
                <input type="text" name="username" tabIndex={-1} autoComplete="username" />
                <input type="password" name="password" tabIndex={-1} autoComplete="current-password" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#0F172A]">Correo electrónico</label>
                <input
                  type="email"
                  name="zentra-login-id"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="usuario@empresa.com"
                  required
                  autoFocus
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#0F172A] transition-all placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#0F172A]">Contraseña</label>
                <div className="relative">
                  <input
                    type={showPass ? "text" : "password"}
                    name="zentra-login-secret"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    autoComplete="new-password"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-10 text-sm text-[#0F172A] transition-all placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseDown={() => setShowPass(true)}
                    onMouseUp={() => setShowPass(false)}
                    onMouseLeave={() => setShowPass(false)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-500 transition-colors hover:text-[#0F172A]"
                    aria-label={showPass ? "Ocultar contraseña" : "Mostrar contraseña"}
                  >
                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 sm:px-4 sm:py-3">
                  <span aria-hidden>⚠</span>
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-[#0EA5E9] px-4 py-2.5 font-medium text-white shadow-sm transition-colors hover:bg-[#0284C7] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
              >
                {loading ? "Verificando…" : "Iniciar sesión"}
              </button>
            </form>
          </div>

          <p className="text-center text-[11px] text-sky-200/55 sm:text-xs">Acceso restringido</p>
        </div>
      </div>
    );
  }

  return (
    <main className="flex min-h-dvh bg-white">
      {/* Panel de marca (turquesa): solo en pantallas grandes. */}
      <aside
        className="relative hidden w-[46%] flex-col justify-between overflow-hidden p-12 text-white lg:flex"
        style={{ background: "linear-gradient(150deg, #3F8E91 0%, #023047 100%)" }}
      >
        <Image
          src="/brand/zentra-logo-official.png"
          alt="ZENTRA"
          width={480}
          height={264}
          priority
          className="h-14 w-auto self-start object-contain"
        />

        <div className="relative z-10">
          <h2 className="max-w-sm text-3xl font-bold leading-tight">Tu negocio, ordenado y en tiempo real.</h2>
          <p className="mt-3 max-w-sm text-sm text-white/70">
            Clientes, proyectos, soporte y conversaciones en un solo lugar. Rápido, seguro y pensado para el día a día.
          </p>
        </div>

        <p className="relative z-10 text-xs text-white/50">Neura ERP · Zentra</p>

        <div className="pointer-events-none absolute -right-20 -top-16 h-72 w-72 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-10 h-80 w-80 rounded-full bg-white/10 blur-3xl" />
      </aside>

      {/* Formulario */}
      <div className="flex flex-1 items-center justify-center px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:p-6">
        <form onSubmit={handleSubmit} className="w-full max-w-sm" autoComplete="off">
          {/*
            Señuelos anti-autofill: algunos navegadores ignoran autoComplete="off"
            en formularios de login y rellenan el primer par usuario/contraseña que
            encuentran. Estos campos ocultos (fuera de pantalla, no display:none para
            que el navegador los considere "reales") capturan ese autofill en lugar de
            los campos visibles. No tienen estado ni participan del submit.
          */}
          <div
            aria-hidden="true"
            style={{ position: "absolute", height: 0, width: 0, overflow: "hidden", opacity: 0, pointerEvents: "none" }}
          >
            <input type="text" name="username" tabIndex={-1} autoComplete="username" />
            <input type="password" name="password" tabIndex={-1} autoComplete="current-password" />
          </div>

          <div className="mb-8">
            {/* El logo es blanco: en el celular va sobre una placa oscura (en escritorio está en el panel de marca). */}
            <div className="mb-5 inline-flex h-14 items-center rounded-xl bg-[#224E55] px-4 lg:hidden">
              <Image
                src="/brand/zentra-logo-official.png"
                alt="ZENTRA"
                width={480}
                height={264}
                priority
                className="h-9 w-auto object-contain"
              />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Iniciá sesión</h1>
            <p className="mt-1 text-sm text-slate-500">Ingresá a Neura ERP.</p>
          </div>

          <label htmlFor="login-correo" className="mb-1.5 block text-sm font-medium text-slate-700">
            Correo electrónico
          </label>
          <div className="relative mb-4">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              id="login-correo"
              type="email"
              name="zentra-login-id"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vos@empresa.com"
              required
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#3F8E91] focus:ring-4 focus:ring-[#3F8E91]/15 sm:text-sm"
            />
          </div>

          <label htmlFor="login-clave" className="mb-1.5 block text-sm font-medium text-slate-700">
            Contraseña
          </label>
          <div className="relative mb-5">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              id="login-clave"
              type={showPass ? "text" : "password"}
              name="zentra-login-secret"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-12 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#3F8E91] focus:ring-4 focus:ring-[#3F8E91]/15 sm:text-sm"
            />
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={() => setShowPass(true)}
              onMouseUp={() => setShowPass(false)}
              onMouseLeave={() => setShowPass(false)}
              onTouchStart={() => setShowPass(true)}
              onTouchEnd={() => setShowPass(false)}
              className="absolute right-1 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              aria-label="Mantené apretado para ver la contraseña"
              title="Mantené apretado para ver la contraseña"
            >
              {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          {error ? (
            <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#3F8E91] px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#357b7e] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {loading ? "Entrando…" : "Iniciar sesión"}
          </button>

          <p className="mt-6 text-center text-[11px] text-slate-400">Acceso restringido</p>
        </form>
      </div>
    </main>
  );
}
