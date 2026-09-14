"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, FolderKanban, MessageCircle } from "lucide-react";
import { useMisModulos } from "@/shared/hooks/useMisModulos";
import { useNotificaciones } from "@/shared/hooks/useNotificaciones";

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
  { href: "/m/asesor", label: "Chats", Icon: MessageCircle, exact: true },
  { href: "/m/asesor/proyectos", label: "Proyectos", Icon: FolderKanban, exact: false },
  { href: "/m/asesor/avisos", label: "Avisos", Icon: Bell, exact: false },
];

export default function AsesorTabBar() {
  const { tieneModulo } = useMisModulos();
  const habilitado = tieneModulo("proyectos_movil") === true;
  const pathname = usePathname() ?? "";
  /* SWR deduplica: comparte la misma petición con la pantalla de Avisos, no la repite. */
  const { noLeidas } = useNotificaciones({ enabled: habilitado });

  if (!habilitado) return null;

  return (
    <nav
      aria-label="Secciones"
      className="shrink-0 border-t border-slate-200 bg-white"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="flex items-stretch">
        {TABS.map(({ href, label, Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
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
