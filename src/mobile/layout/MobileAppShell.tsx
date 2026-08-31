"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import BottomNav from "./BottomNav";
import MobileHeader from "./MobileHeader";
import MobileMenu from "./MobileMenu";
import CapacitorPushRegister from "@/components/CapacitorPushRegister";

const STANDALONE_ROUTES = ["/login"];

/**
 * Shell mobile del ERP. Liviano — sin framer-motion.
 *
 *  ┌──────────────────────────────┐
 *  │  MobileHeader (sticky top)   │
 *  ├──────────────────────────────┤
 *  │      Contenido (main)        │
 *  ├──────────────────────────────┤
 *  │  BottomNav (fixed bottom)    │
 *  └──────────────────────────────┘
 *
 *  Menú lateral: MobileMenu (CSS-only) que se desliza desde la izquierda al tocar
 *  el ícono de menú del header o "Más" del bottom nav. NO usa el Sidebar desktop
 *  (que carga framer-motion + favoritos + búsqueda compleja).
 */
export default function MobileAppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // /m/* = app móvil del asesor (Capacitor/APK): pantalla completa, sin header/bottom-nav del ERP.
  const isStandalone =
    !!pathname && (STANDALONE_ROUTES.includes(pathname) || pathname.startsWith("/m/"));
  const [menuOpen, setMenuOpen] = useState(false);

  // Cerrar el menú al cambiar de ruta.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  if (isStandalone) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-svh min-h-0 flex-col overflow-hidden bg-[#F8FAFC]">
      {/*
        Registro de push dentro de la APK. Vive acá y no en una pantalla puntual
        porque el shell persiste entre navegaciones: si se monta en una page, al
        salir de ella el cleanup remueve el listener `registration` y el token
        nunca llega. No entra en /login ni /m/* (esas rutas salen por isStandalone).
        En navegador es no-op: el componente chequea Capacitor.isNativePlatform().
      */}
      <CapacitorPushRegister />

      <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} />

      <MobileHeader onOpenMenu={() => setMenuOpen(true)} />

      <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain pb-16">
        {children}
      </main>

      <BottomNav onOpenMenu={() => setMenuOpen(true)} />
    </div>
  );
}
