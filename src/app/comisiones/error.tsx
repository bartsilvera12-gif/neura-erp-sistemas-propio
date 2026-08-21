"use client";

/**
 * Error boundary del módulo Comisiones.
 *
 * Muestra el error real para poder diagnosticar sin abrir la consola, PERO
 * pasado por un filtro: cuando el origen se cae, el proxy devuelve una página
 * HTML de error y ese HTML entero terminaba dentro del mensaje. En pantalla se
 * veían ~4 KB de markup de Cloudflare, ilegibles y sin decir qué pasó.
 *
 * Ahora un error así se reconoce y se traduce a algo accionable; el texto crudo
 * queda disponible en el detalle técnico para soporte.
 */

/** ¿El mensaje es en realidad una página HTML (típicamente un 5xx del proxy)? */
function esPaginaHtml(msg: string): boolean {
  const t = msg.trimStart().slice(0, 200).toLowerCase();
  return t.startsWith("<!doctype") || t.startsWith("<html") || t.includes("<head");
}

/** Interpreta el error para mostrar algo que se entienda. */
function interpretar(error: Error | undefined): { titulo: string; detalle: string } {
  const msg = error?.message ?? "";

  if (esPaginaHtml(msg)) {
    // Cloudflare pone el código en el <title>: "… | 502: Bad gateway".
    const codigo = /\b(50[0-4])\b/.exec(msg)?.[1];
    return {
      titulo: "El servidor no está respondiendo",
      detalle:
        `Comisiones no pudo cargar porque el servidor devolvió un error${codigo ? ` ${codigo}` : ""}. ` +
        "Suele ser pasajero: esperá un momento y tocá Reintentar. Si sigue, avisá a soporte.",
    };
  }

  if (/fetch failed|network|load failed/i.test(msg)) {
    return {
      titulo: "No se pudo conectar",
      detalle: "Revisá tu conexión a internet y volvé a intentar.",
    };
  }

  return {
    titulo: "Se produjo un error al cargar Comisiones",
    detalle: msg || "(sin mensaje)",
  };
}

export default function ComisionesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { titulo, detalle } = interpretar(error);
  // Sólo se ofrece el crudo cuando aporta: si ya se mostró tal cual arriba,
  // repetirlo en un desplegable no suma.
  const hayCrudo = Boolean(error?.message) && error.message !== detalle;

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5 shadow-sm">
        <h2 className="text-base font-semibold text-red-800">{titulo}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-red-700">{detalle}</p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700"
          >
            Reintentar
          </button>
          {error?.digest ? (
            <span className="text-[11px] text-red-600">
              Referencia para soporte: <code className="font-mono">{error.digest}</code>
            </span>
          ) : null}
        </div>

        {hayCrudo || error?.stack ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-red-600">
              Detalle técnico
            </summary>
            {hayCrudo ? (
              <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-red-200 bg-white px-3 py-2 text-[11px] leading-relaxed text-slate-700">
                {error.message.slice(0, 2000)}
              </pre>
            ) : null}
            {error?.stack ? (
              <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-red-200 bg-white px-3 py-2 text-[11px] leading-relaxed text-slate-700">
                {error.stack}
              </pre>
            ) : null}
          </details>
        ) : null}
      </div>
    </div>
  );
}
