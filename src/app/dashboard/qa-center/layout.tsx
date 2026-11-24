/**
 * Layout del QA Center: envuelve todas las sub-páginas con el sub-nav
 * horizontal (Proyectos · Ejecución · Resultados · Historial). Las
 * pantallas de detalle (p.ej. /runs/[id]) también heredan este layout.
 */
import QaCenterNav from "./_ui/QaCenterNav";

export default function QaCenterLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <QaCenterNav />
      {children}
    </div>
  );
}
