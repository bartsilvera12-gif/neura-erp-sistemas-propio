"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import AsesorTabBar from "../../AsesorTabBar";

type Prefs = {
  chat_enabled: boolean;
  avisos_enabled: boolean;
  soporte_enabled: boolean;
  proyectos_enabled: boolean;
};

const DEFAULTS: Prefs = {
  chat_enabled: true,
  avisos_enabled: true,
  soporte_enabled: true,
  proyectos_enabled: true,
};

const ITEMS: Array<{ key: keyof Prefs; label: string; hint: string }> = [
  { key: "chat_enabled", label: "Chats", hint: "Mensajes nuevos, leads asignados, reasignaciones, SLA" },
  { key: "avisos_enabled", label: "Avisos", hint: "Notificaciones del módulo Avisos" },
  { key: "soporte_enabled", label: "Soporte", hint: "Tickets asignados y actualizaciones" },
  { key: "proyectos_enabled", label: "Proyectos", hint: "Cambios de estado y asignaciones" },
];

/**
 * Preferencias de notificaciones push por asesor. Afecta solo a este usuario — el resto del
 * equipo sigue recibiendo normal. El dispatcher consulta esta tabla antes de enviar el push.
 */
export default function ConfiguracionNotificacionesPage() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState<keyof Prefs | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const r = await fetchWithSupabaseSession("/api/mobile/asesor/notification-prefs", {
          cache: "no-store",
        });
        const j = (await r.json().catch(() => null)) as { ok?: boolean; prefs?: Prefs; error?: string } | null;
        if (!vivo) return;
        if (!r.ok || !j?.ok || !j.prefs) {
          setError(j?.error ?? `HTTP ${r.status}`);
        } else {
          setPrefs(j.prefs);
        }
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : "No se pudo cargar");
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const toggle = async (key: keyof Prefs) => {
    const nuevo = !prefs[key];
    setPrefs((p) => ({ ...p, [key]: nuevo }));
    setGuardando(key);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/mobile/asesor/notification-prefs", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [key]: nuevo }),
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; prefs?: Prefs; error?: string } | null;
      if (!r.ok || !j?.ok) {
        // Revertir si el server rechazó
        setPrefs((p) => ({ ...p, [key]: !nuevo }));
        setError(j?.error ?? `HTTP ${r.status}`);
      } else if (j.prefs) {
        setPrefs(j.prefs);
      }
    } catch (e) {
      setPrefs((p) => ({ ...p, [key]: !nuevo }));
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(null);
    }
  };

  return (
    <div className="flex h-svh min-h-0 flex-col bg-slate-50">
      <header
        className="z-10 shrink-0 bg-[#3F8E91] px-4 pb-3 text-white shadow-sm"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}
      >
        <div className="flex items-center gap-2">
          <Link
            href="/m/asesor"
            aria-label="Volver"
            className="shrink-0 grid h-9 w-9 place-items-center rounded-full text-white/90 active:bg-white/15"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </Link>
          <div>
            <h1 className="text-base font-semibold leading-tight">Notificaciones</h1>
            <p className="text-[11px] leading-tight text-white/80">Preferencias de este usuario</p>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <p className="mx-1 mb-3 text-[12px] leading-relaxed text-slate-500">
          Apagá las categorías que no querés recibir en este celular. Los cambios se aplican
          solo a tu usuario — el resto del equipo sigue recibiendo todo.
        </p>

        {cargando ? (
          <p className="p-6 text-center text-sm text-slate-400 animate-pulse">Cargando…</p>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {ITEMS.map((it) => {
              const on = prefs[it.key];
              const busy = guardando === it.key;
              return (
                <li key={it.key} className="flex items-center justify-between gap-3 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-slate-900">{it.label}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{it.hint}</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={`${it.label}: ${on ? "activado" : "apagado"}`}
                    disabled={busy}
                    onClick={() => void toggle(it.key)}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                      on ? "bg-[#3F8E91]" : "bg-slate-300"
                    } ${busy ? "opacity-60" : ""}`}
                  >
                    <span
                      aria-hidden
                      className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                        on ? "translate-x-5" : ""
                      }`}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {error ? (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-[12px] text-red-700">{error}</p>
        ) : null}
      </main>

      <AsesorTabBar />
    </div>
  );
}
