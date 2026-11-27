"use client";

/**
 * Sub-navegación horizontal del QA Center. Reemplaza el scroll largo con
 * secciones diferenciadas: Proyectos, Ejecución, Resultados, Historial.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactElement } from "react";

const TABS: Array<{ href: string; label: string; icon: ReactElement }> = [
  {
    href: "/dashboard/qa-center",
    label: "Proyectos",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>
      </svg>
    ),
  },
  {
    href: "/dashboard/qa-center/resultados",
    label: "Resultados",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
      </svg>
    ),
  },
  {
    href: "/dashboard/qa-center/historial",
    label: "Historial",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/>
      </svg>
    ),
  },
  {
    href: "/dashboard/qa-center/entregados",
    label: "Entregados",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><path d="m9 11 2 2 4-4"/>
      </svg>
    ),
  },
];

export default function QaCenterNav() {
  const pathname = usePathname();
  return (
    <nav className="sticky top-0 z-10 -mx-4 mb-6 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:-mx-6 sm:px-6" aria-label="Secciones de QA Center">
      <div className="flex items-end gap-1 overflow-x-auto">
        {TABS.map((tab) => {
          const activo = tab.href === "/dashboard/qa-center"
            ? pathname === tab.href
            : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`relative flex items-center gap-2 whitespace-nowrap px-3 py-3 text-sm font-medium transition-colors ${
                activo
                  ? "text-[#0B3A3D]"
                  : "text-slate-500 hover:text-slate-900"
              }`}
              data-testid={`qa-tab-${tab.href.split("/").pop() || "home"}`}
            >
              <span className={activo ? "text-[#0EA5E9]" : "text-slate-400"}>{tab.icon}</span>
              {tab.label}
              {activo && (
                <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-t-full bg-[#0EA5E9]" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
