/**
 * Layout del QA Center: la navegación entre Proyectos / Resultados /
 * Historial / Entregados vive en el sidebar global y el QaCenterNav
 * horizontal. Acá envolvemos los children con una transición fade-in
 * para que al cambiar de sub-ruta no se sienta "muerto".
 */
export default function QaCenterLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="animate-[qa-fade-in_180ms_ease-out]">
      <style>{`
        @keyframes qa-fade-in {
          from { opacity: 0; transform: translateY(2px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      {children}
    </div>
  );
}
