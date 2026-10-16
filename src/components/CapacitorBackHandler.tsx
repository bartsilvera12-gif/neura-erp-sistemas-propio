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

        const sub = await App.addListener("backButton", ({ canGoBack }) => {
          if (canGoBack) {
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
