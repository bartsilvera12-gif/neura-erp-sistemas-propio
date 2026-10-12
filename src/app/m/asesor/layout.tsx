import type { ReactNode } from "react";
import CapacitorPushRegister from "@/components/CapacitorPushRegister";

/**
 * Layout de /m/asesor/*.
 *
 * Monta el registro de push a nivel layout para que se registre en CUALQUIER pantalla de la
 * app —inbox, proyectos, avisos, soporte— y siga montado al navegar entre ellas.
 *
 * Antes había un gate (MAsesorPushGate) por acceso móvil especial porque la APK vieja se
 * compilaba sin google-services.json y crasheaba al inicializar el plugin de push. Hoy la
 * APK que distribuimos ya trae el archivo correcto, así que el gate se quitó para que todos
 * los asesores puedan registrar su token FCM.
 *
 * En navegador el componente es no-op: internamente chequea Capacitor.isNativePlatform().
 */
export default function MAsesorLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <CapacitorPushRegister />
    </>
  );
}
