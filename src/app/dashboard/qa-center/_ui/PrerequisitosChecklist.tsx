"use client";

/**
 * Checklist de prerrequisitos visibles ANTES de tocar "Analizar ERP completo".
 * El botón sigue siendo clickeable, pero este bloque explica qué partes del
 * pipeline van a correr y cuáles van a quedar en "pendientes".
 */

export type PrerequisitosChecklistProps = {
  togglePermiteLectura: boolean;
  anthropicConfigured: boolean | null; // null = desconocido (no sondeado)
  credencialesRoRunnerConfigured: boolean | null;
};

type Item = { ok: boolean | null; label: string; detalle: string; descripcion: string };

export default function PrerequisitosChecklist(props: PrerequisitosChecklistProps) {
  const items: Item[] = [
    {
      ok: props.togglePermiteLectura,
      label: "Toggle de autorización de lectura",
      detalle: props.togglePermiteLectura
        ? "El admin del proyecto autorizó correr pruebas de lectura."
        : "Sin esta autorización, los specs IA se generan pero NO se ejecutan contra el ERP (quedan bloqueados).",
      descripcion: props.togglePermiteLectura ? "Autorizado" : "No autorizado",
    },
    {
      ok: props.credencialesRoRunnerConfigured,
      label: "Credenciales QA de sólo lectura en el runner",
      detalle:
        props.credencialesRoRunnerConfigured === false
          ? "QA_RO_EMAIL / QA_RO_PASSWORD no están cargadas en el runner. Los specs no van a poder loguearse."
          : props.credencialesRoRunnerConfigured === null
            ? "No se pudo verificar (el runner las informará al próximo heartbeat)."
            : "Cargadas y disponibles.",
      descripcion:
        props.credencialesRoRunnerConfigured === true
          ? "Configuradas"
          : props.credencialesRoRunnerConfigured === false
            ? "Faltan"
            : "Desconocido",
    },
    {
      ok: props.anthropicConfigured,
      label: "Clave de Anthropic en el runner (ANTHROPIC_API_KEY)",
      detalle:
        props.anthropicConfigured === false
          ? "Sin la clave, el análisis se queda en el mapa de módulos (sin generar pruebas ni informe narrativo)."
          : props.anthropicConfigured === null
            ? "No se pudo verificar; se asume configurada hasta recibir el primer heartbeat."
            : "Cargada. La IA puede comprender, generar pruebas y redactar el informe.",
      descripcion:
        props.anthropicConfigured === true
          ? "Configurada"
          : props.anthropicConfigured === false
            ? "Falta"
            : "Desconocido",
    },
  ];

  const faltantes = items.filter((i) => i.ok === false).length;

  return (
    <div className="mt-3 rounded-lg border bg-white p-3" data-testid="prerequisitos-checklist">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-900">Qué va a poder correr</h4>
        <span className={`text-[11px] font-medium ${faltantes === 0 ? "text-emerald-700" : "text-amber-800"}`}>
          {faltantes === 0 ? "Todos los prerrequisitos listos" : `${faltantes} pendiente(s)`}
        </span>
      </div>
      <ul className="mt-2 space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-2 text-xs">
            <span
              className={`mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${
                it.ok === true
                  ? "bg-emerald-100 text-emerald-800"
                  : it.ok === false
                    ? "bg-rose-100 text-rose-800"
                    : "bg-slate-200 text-slate-700"
              }`}
            >
              {it.ok === true ? "✓" : it.ok === false ? "✗" : "?"}
            </span>
            <div className="flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-medium text-slate-800">{it.label}</p>
                <p className="shrink-0 text-[11px] text-slate-500">{it.descripcion}</p>
              </div>
              <p className="text-[11px] text-slate-600">{it.detalle}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
