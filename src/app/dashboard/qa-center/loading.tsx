/**
 * Skeleton que se muestra instantáneamente al navegar a cualquier sub-ruta
 * del QA Center mientras el server component termina de cargar. Elimina el
 * "muerto" entre el click y el render.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl animate-pulse">
      {/* header */}
      <div className="mb-6">
        <div className="h-5 w-40 rounded bg-slate-200/70" />
        <div className="mt-2 h-3 w-72 rounded bg-slate-200/60" />
      </div>
      {/* contenido */}
      <div className="grid gap-3 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="min-h-[220px] rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="h-7 w-full rounded bg-slate-200/70" />
            <div className="mt-3 space-y-2">
              {[0, 1, 2].map((j) => (
                <div key={j} className="h-20 rounded-lg bg-slate-100" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
