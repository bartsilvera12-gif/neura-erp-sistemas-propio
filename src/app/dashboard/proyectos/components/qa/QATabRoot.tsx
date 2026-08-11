"use client";

import { useState } from "react";
import ChecklistView from "./ChecklistView";
import ObservacionesBoard from "./ObservacionesBoard";
import type { QATabProps } from "./types";

type Vista = "observaciones" | "checklist";

/**
 * La pestaña QA tiene dos módulos que conviven: el registro de observaciones
 * (lo que se usa día a día, y por eso es el default) y el checklist jerárquico
 * original, intacto para los proyectos que ya tienen grupos cargados.
 */
export default function QATabRoot({ projectId, dataSchema, usuarios, projectTitle }: QATabProps) {
  const [vista, setVista] = useState<Vista>("observaciones");

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        {(
          [
            { id: "observaciones", label: "Observaciones" },
            { id: "checklist", label: "Checklist" },
          ] as const
        ).map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setVista(v.id)}
            aria-pressed={vista === v.id}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
              vista === v.id
                ? "bg-[#4FAEB2]/10 text-[#3F8E91]"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {vista === "observaciones" ? (
        <ObservacionesBoard
          projectId={projectId}
          dataSchema={dataSchema}
          usuarios={usuarios}
          projectTitle={projectTitle}
        />
      ) : (
        <ChecklistView projectId={projectId} dataSchema={dataSchema} usuarios={usuarios} />
      )}
    </div>
  );
}
