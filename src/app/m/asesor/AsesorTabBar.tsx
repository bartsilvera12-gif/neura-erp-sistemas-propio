"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Bell, FolderKanban, Headphones, MessageCircle } from "lucide-react";
import { useMisModulos } from "@/shared/hooks/useMisModulos";
import useSWR from "swr";
import { useNotificaciones } from "@/shared/hooks/useNotificaciones";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

/**
 * Barra de pestañas de la app del asesor.
 *
 * Hasta ahora /m/asesor era UNA sola pantalla sin navegación, y así se queda para casi
 * todos: si el usuario no tiene el módulo `proyectos_movil` esto no renderiza nada y la
 * app se ve exactamente igual que antes. Solo aparece para quien tenga la fila explícita
 * en `usuario_modulos` (ver MODULOS_RESTRINGIDOS) — se asigna desde /usuarios/[id].
 *
 * Mientras no sabemos si lo tiene (`null`) tampoco se dibuja, para que no aparezca de
 * golpe medio segundo después de abrir la app.
 *
 * Va como hijo normal del contenedor flex de la pantalla, no `fixed`: así el scroll no
 * queda tapado y no hace falta calcular padding contra la safe area del iPhone.
 */

const TABS = [
  { href: "/m/asesor", label: "Chats", Icon: MessageCircle, exact: true, modulo: null },
  { href: "/m/asesor/proyectos", label: "Proyectos", Icon: FolderKanban, exact: false, modulo: null },
  { href: "/m/asesor/avisos", label: "Avisos", Icon: Bell, exact: false, modulo: null },
  /**
   * Soporte abre el módulo REAL, tal cual funciona en el navegador, y no una copia metida
   * adentro de /m/asesor. El módulo tiene decenas de enlaces internos a /dashboard/soporte/...:
   * una copia se saldría al primer toque, salvo reescribirlos todos en código de otro módulo.
   *
   * Va a /tickets y no al tablero, igual que el menú lateral: PM, QA y Desarrollo no ven el
   * Dashboard, y con ese enlace caían en una página que no pueden abrir.
   */
  { href: "/dashboard/soporte/tickets", label: "Soporte", Icon: Headphones, exact: false, modulo: "soporte" },
] as const;

/** Clave de sesión que marca "entré por la app del asesor". Ver MobileAppShell. */
export const MARCA_APP_ASESOR = "neura:app-asesor";

/**
 * ¿Puede entrar a Soporte? Lo responde el propio módulo (`/api/soporte/acceso`), con su regla
 * exacta: rol admin, super admin o fila explícita en `usuario_modulos`.
 *
 * NO se usa `tieneModulo("soporte")` de la lista general: esa lista, para un usuario común,
 * exige además que el módulo esté activo en `empresa_modulos`, y Soporte no lo exige. Con ese
 * chequeo alguien podía entrar a Soporte sin que la pestaña apareciera nunca.
 */
function useAccesoSoporte(habilitado: boolean): boolean {
  const { data } = useSWR(
    habilitado ? "/api/soporte/acceso" : null,
    async (url: string) => {
      const r = await fetchWithSupabaseSession(url, { cache: "no-store" });
      return r.ok;
    },
    { revalidateOnFocus: false }
  );
  return data === true;
}

export default function AsesorTabBar() {
  const { tieneModulo } = useMisModulos();
  const habilitado = tieneModulo("proyectos_movil") === true;
  const pathname = usePathname() ?? "";
  /* SWR deduplica: comparte la misma petición con la pantalla de Avisos, no la repite. */
  const { noLeidas } = useNotificaciones({ enabled: habilitado });
  const accesoSoporte = useAccesoSoporte(habilitado);

  // Soporte abre el módulo real en /dashboard/soporte, que por ruta cae en el shell del ERP
  // con su propia barra (Inicio / Chats / Ventas…). Esta marca le avisa al shell que se llegó
  // desde la app del asesor, para que ahí siga mostrando ESTA barra. sessionStorage y no
  // localStorage: vale mientras dure la sesión de la app, no para siempre.
  useEffect(() => {
    if (!habilitado) return;
    try {
      sessionStorage.setItem(MARCA_APP_ASESOR, "1");
    } catch {
      /* navegador sin storage: se ve la barra del ERP, que igual funciona */
    }
  }, [habilitado]);

  if (!habilitado) return null;

  return (
    <nav
      aria-label="Secciones"
      className="shrink-0 border-t border-slate-200 bg-white"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="flex items-stretch">
        {TABS.filter((t) => t.modulo !== "soporte" || accesoSoporte).map(({ href, label, Icon, exact }) => {
          // Soporte abarca todo el módulo (/mis-tickets, un ticket, etc.), no solo /tickets.
          const prefijo = href.startsWith("/dashboard/soporte") ? "/dashboard/soporte" : href;
          const active = exact ? pathname === href : pathname.startsWith(prefijo);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex h-14 min-h-[44px] flex-col items-center justify-center gap-0.5 transition-colors ${
                  active ? "text-[#3F8E91]" : "text-slate-400 active:text-slate-600"
                }`}
              >
                <span className="relative">
                  <Icon className="h-5 w-5" aria-hidden />
                  {href === "/m/asesor/avisos" && noLeidas > 0 ? (
                    <span
                      className="absolute -right-2 -top-1 grid h-[16px] min-w-[16px] place-items-center rounded-full bg-[#0EA5E9] px-1 text-[9px] font-bold text-white"
                      aria-label={`${noLeidas} sin leer`}
                    >
                      {noLeidas > 99 ? "99+" : noLeidas}
                    </span>
                  ) : null}
                </span>
                <span className="text-[10px] font-medium tracking-tight">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
