/**
 * Layout del QA Center: la navegación entre Proyectos / Ejecución /
 * Resultados / Historial vive en el sidebar global (ver `Sidebar.tsx`),
 * así que acá sólo pasamos los children sin sub-nav extra.
 */
export default function QaCenterLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
