"use client";

/**
 * Error boundary del módulo Comisiones. En vez de una pantalla en blanco con el mensaje genérico
 * de Next ("excepción del lado del cliente"), muestra el error REAL en pantalla para poder
 * diagnosticarlo sin abrir la consola del navegador. Temporal para depurar el crash de /comisiones.
 */
export default function ComisionesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5 shadow-sm">
        <h2 className="text-base font-semibold text-red-800">
          Se produjo un error al cargar Comisiones
        </h2>
        <p className="mt-1 text-xs text-red-700">
          Pasale esta pantalla a soporte (sacá una captura de todo lo de abajo):
        </p>

        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-red-600">
            Mensaje
          </p>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded-lg border border-red-200 bg-white px-3 py-2 text-xs text-slate-800">
            {error?.message || "(sin mensaje)"}
          </pre>
        </div>

        {error?.digest ? (
          <div className="mt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-red-600">
              Digest
            </p>
            <pre className="mt-1 overflow-x-auto rounded-lg border border-red-200 bg-white px-3 py-2 text-xs text-slate-800">
              {error.digest}
            </pre>
          </div>
        ) : null}

        {error?.stack ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-red-600">
              Detalle técnico (stack)
            </summary>
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-red-200 bg-white px-3 py-2 text-[11px] leading-relaxed text-slate-700">
              {error.stack}
            </pre>
          </details>
        ) : null}

        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700"
        >
          Reintentar
        </button>
      </div>
    </div>
  );
}
