import type { ReactNode } from "react";
import MAsesorPushGate from "./MAsesorPushGate";

/**
 * Layout de /m/asesor/*.
 *
 * Monta el registro de push (gateado al acceso móvil especial, ver MAsesorPushGate) a nivel
 * layout para que se registre en CUALQUIER pantalla de la app —inbox, proyectos, avisos,
 * soporte— y siga montado al navegar entre ellas. Es necesario porque el acceso móvil
 * especial entra directo a /m/asesor/proyectos y nunca pasa por el inbox, que es donde antes
 * (hasta el PR #4) vivía el registro de push.
 *
 * No agrega UI: el gate renderiza el registro (sin interfaz) o null.
 */
export default function MAsesorLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <MAsesorPushGate />
    </>
  );
}
