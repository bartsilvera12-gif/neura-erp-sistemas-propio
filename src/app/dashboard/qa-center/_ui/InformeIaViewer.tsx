"use client";

/**
 * Renderiza el informe IA generado por el agente (resumen + módulos).
 * Se asume que el informe fue producido respetando la regla "no aprobado sin
 * ejecución": lo que aparece en funciona_bien ya se ejecutó con éxito.
 */

type InformeModulo = {
  nombre: string;
  funciona_bien?: string[];
  fallas?: Array<{
    funcion_revisada?: string;
    resultado_esperado?: string;
    resultado_obtenido?: string;
    recomendacion?: string;
  }>;
  pendientes?: Array<{ funcion_revisada?: string; motivo?: string }>;
};

export type InformeIaViewerProps = {
  resumen: string;
  modulos: InformeModulo[];
  parcial?: boolean;
  createdAt?: string;
};

export default function InformeIaViewer({ resumen, modulos, parcial, createdAt }: InformeIaViewerProps) {
  return (
    <div className="mt-3 rounded-lg border bg-white p-4" data-testid="informe-ia-viewer">
      <div className="flex items-start justify-between">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">Informe funcional detallado</h4>
          {createdAt && (
            <p className="text-[11px] text-slate-500">
              Generado el {new Date(createdAt).toLocaleString()}
            </p>
          )}
        </div>
        {parcial && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
            Informe parcial — revisar manualmente
          </span>
        )}
      </div>

      <p className="mt-2 text-sm text-slate-700">{resumen}</p>

      <div className="mt-3 space-y-3">
        {modulos.map((m, idx) => (
          <div key={idx} className="rounded border border-slate-200 bg-slate-50 p-3">
            <h5 className="text-sm font-semibold text-slate-800">{m.nombre}</h5>

            {Array.isArray(m.funciona_bien) && m.funciona_bien.length > 0 && (
              <div className="mt-2">
                <p className="text-[11px] font-semibold uppercase text-emerald-700">Funciona bien</p>
                <ul className="mt-1 space-y-0.5 text-xs text-slate-700">
                  {m.funciona_bien.map((f, i) => (
                    <li key={i}>✓ {f}</li>
                  ))}
                </ul>
              </div>
            )}

            {Array.isArray(m.fallas) && m.fallas.length > 0 && (
              <div className="mt-2">
                <p className="text-[11px] font-semibold uppercase text-rose-700">Fallas detectadas</p>
                <ul className="mt-1 space-y-1 text-xs text-slate-700">
                  {m.fallas.map((f, i) => (
                    <li key={i} className="rounded bg-white p-2">
                      <p className="font-medium text-slate-800">
                        {f.funcion_revisada ?? "función revisada"}
                      </p>
                      {f.resultado_esperado && (
                        <p className="text-slate-600">
                          <span className="text-slate-500">Esperado:</span> {f.resultado_esperado}
                        </p>
                      )}
                      {f.resultado_obtenido && (
                        <p className="text-slate-600">
                          <span className="text-slate-500">Obtenido:</span> {f.resultado_obtenido}
                        </p>
                      )}
                      {f.recomendacion && (
                        <p className="text-slate-700">
                          <span className="font-semibold">Recomendación:</span> {f.recomendacion}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {Array.isArray(m.pendientes) && m.pendientes.length > 0 && (
              <div className="mt-2">
                <p className="text-[11px] font-semibold uppercase text-slate-500">Pendientes / bloqueados</p>
                <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                  {m.pendientes.map((p, i) => (
                    <li key={i}>
                      • {p.funcion_revisada ?? ""} <span className="text-slate-400">— {p.motivo ?? "sin motivo"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
