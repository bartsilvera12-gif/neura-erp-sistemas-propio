"use client";

/**
 * Cobertura visible del último análisis IA, por módulo.
 *   verde:  executed_pass
 *   rojo:   executed_fail / executed_error
 *   gris:   pending / blocked_env_assert / blocked_safety (con motivo)
 */

export type CoberturaModulo = {
  modulo: string;
  pending: number;
  executed_pass: number;
  executed_fail: number;
  executed_error: number;
  blocked_env_assert: number;
  blocked_safety: number;
};

export type CoberturaIAViewerProps = {
  cobertura: CoberturaModulo[];
};

const MOTIVOS: Record<string, string> = {
  pending: "No se ejecutó en esta corrida",
  blocked_env_assert:
    "El ERP no autoriza ejecución. Falta activar el toggle del admin o que el ERP exponga env-assert.",
  blocked_safety:
    "El spec fue descartado por los controles de seguridad (sanitizador).",
};

export default function CoberturaIAViewer({ cobertura }: CoberturaIAViewerProps) {
  if (!cobertura || cobertura.length === 0) {
    return (
      <div className="mt-3 rounded border bg-white p-3 text-xs text-slate-500">
        Todavía no hay cobertura registrada. Al tocar <strong>Analizar ERP completo</strong> se
        descubren los módulos y se generan/ejecutan las pruebas.
      </div>
    );
  }

  const totales = cobertura.reduce(
    (acc, m) => ({
      executed_pass: acc.executed_pass + m.executed_pass,
      executed_fail: acc.executed_fail + m.executed_fail,
      executed_error: acc.executed_error + m.executed_error,
      pending: acc.pending + m.pending,
      blocked_env_assert: acc.blocked_env_assert + m.blocked_env_assert,
      blocked_safety: acc.blocked_safety + m.blocked_safety,
    }),
    { executed_pass: 0, executed_fail: 0, executed_error: 0, pending: 0, blocked_env_assert: 0, blocked_safety: 0 }
  );

  return (
    <div className="mt-3 rounded-lg border bg-white p-4" data-testid="cobertura-ia-viewer">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-900">Cobertura del último análisis</h4>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-800">
            {totales.executed_pass} aprobadas
          </span>
          <span className="rounded bg-rose-100 px-2 py-0.5 text-rose-800">
            {totales.executed_fail + totales.executed_error} fallidas
          </span>
          <span className="rounded bg-slate-200 px-2 py-0.5 text-slate-700">
            {totales.pending + totales.blocked_env_assert + totales.blocked_safety} pendientes
          </span>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {cobertura.map((m, i) => {
          const total = m.executed_pass + m.executed_fail + m.executed_error + m.pending + m.blocked_env_assert + m.blocked_safety;
          return (
            <div key={i} className="rounded border bg-slate-50 p-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-800">{m.modulo}</p>
                <p className="text-[11px] text-slate-500">{total} función(es)</p>
              </div>
              <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
                {m.executed_pass > 0 && (
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800">
                    ✓ {m.executed_pass} aprobadas
                  </span>
                )}
                {m.executed_fail > 0 && (
                  <span className="rounded bg-rose-100 px-1.5 py-0.5 text-rose-800">
                    ✗ {m.executed_fail} fallidas
                  </span>
                )}
                {m.executed_error > 0 && (
                  <span className="rounded bg-rose-100 px-1.5 py-0.5 text-rose-800">
                    ⚠ {m.executed_error} con error
                  </span>
                )}
                {m.pending > 0 && (
                  <span className="rounded bg-slate-200 px-1.5 py-0.5 text-slate-700" title={MOTIVOS.pending}>
                    ⏳ {m.pending} pendientes
                  </span>
                )}
                {m.blocked_env_assert > 0 && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900" title={MOTIVOS.blocked_env_assert}>
                    🔒 {m.blocked_env_assert} bloqueadas por autorización
                  </span>
                )}
                {m.blocked_safety > 0 && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900" title={MOTIVOS.blocked_safety}>
                    🛡 {m.blocked_safety} bloqueadas por seguridad
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
