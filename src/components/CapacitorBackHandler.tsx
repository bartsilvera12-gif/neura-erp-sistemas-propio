"use client";

import { useEffect } from "react";

/**
 * Intercepta el botón físico "atrás" de Android dentro de la APK (Capacitor nativo).
 *
 * Comportamiento por defecto de Capacitor: el botón atrás cierra la app en cualquier pantalla.
 * Lo esperado por el usuario: volver una pantalla dentro del WebView; si no hay historial,
 * ahí sí minimizar/salir de la app (igual que WhatsApp estando en el inbox).
 *
 * En navegador/desktop es NO-OP: chequea `Capacitor.isNativePlatform()` antes de importar
 * nada nativo, así que no afecta a usuarios web.
 */
export default function CapacitorBackHandler() {
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor?.isNativePlatform?.()) return;

        const { App } = await import("@capacitor/app");
        if (cancelled) return;

        // Rutas "raíz" de la app: desde acá el botón atrás minimiza en vez de volver.
        // Sin esto, atrás desde /m/asesor termina llevando a /login (que estaba antes en
        // history por el redirect de sesión), lo cual es confuso.
        const isRootPath = (p: string): boolean => {
          const path = p.split("?")[0]?.split("#")[0] ?? p;
          return (
            path === "/" ||
            path === "/login" ||
            path === "/m/asesor" ||
            path === "/m/asesor/" ||
            path === "/dashboard" ||
            path === "/dashboard/"
          );
        };

        const sub = await App.addListener("backButton", ({ canGoBack }) => {
          const path = window.location.pathname;
          if (canGoBack && !isRootPath(path)) {
            window.history.back();
          } else {
            void App.minimizeApp().catch(() => {
              /* si minimize no está disponible, dejamos que el default salga */
            });
          }
        });

        cleanup = () => {
          void sub.remove();
        };
      } catch {
        /* entorno sin capa nativa → no-op */
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return null;
}
