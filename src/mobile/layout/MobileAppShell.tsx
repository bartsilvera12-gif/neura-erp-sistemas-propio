"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import BottomNav from "./BottomNav";
import MobileHeader from "./MobileHeader";
import MobileMenu from "./MobileMenu";
import CapacitorPushRegister from "@/components/CapacitorPushRegister";
import AsesorTabBar, { MARCA_APP_ASESOR } from "@/app/m/asesor/AsesorTabBar";

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

  // ¿Se llegó a esta pantalla desde la app del asesor? La marca la deja su barra de pestañas.
  // Se lee en un efecto y no durante el render: sessionStorage no existe en el servidor, y
  // leerlo antes rompería la hidratación.
  const [desdeAppAsesor, setDesdeAppAsesor] = useState(false);
  useEffect(() => {
    try {
      setDesdeAppAsesor(sessionStorage.getItem(MARCA_APP_ASESOR) === "1");
    } catch {
      setDesdeAppAsesor(false);
    }
  }, [pathname]);

  // Cerrar el menú al cambiar de ruta.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  if (isStandalone) {
    return <>{children}</>;
  }

  // Soporte abierto desde la app del asesor: sin el encabezado ni la barra del ERP, con la
  // barra de la app. Solo para /dashboard/soporte — si desde ahí se navega a otra sección del
  // ERP, vuelve el shell normal, que es lo que corresponde a esa pantalla.
  if (desdeAppAsesor && pathname?.startsWith("/dashboard/soporte")) {
    return (
      <div className="flex h-svh min-h-0 flex-col overflow-hidden bg-[#F8FAFC]">
        <CapacitorPushRegister />
        <main
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain"
          // Sin el encabezado del ERP nadie reserva la barra de estado del iPhone.
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          {children}
        </main>
        <AsesorTabBar />
      </div>
    );
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
