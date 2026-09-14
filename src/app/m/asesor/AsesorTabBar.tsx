"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FolderKanban, MessageCircle } from "lucide-react";
import { useMisModulos } from "@/shared/hooks/useMisModulos";

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
];

export default function AsesorTabBar() {
  const { tieneModulo } = useMisModulos();
  const pathname = usePathname() ?? "";

  if (tieneModulo("proyectos_movil") !== true) return null;

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
                <Icon className="h-5 w-5" aria-hidden />
                <span className="text-[10px] font-medium tracking-tight">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
