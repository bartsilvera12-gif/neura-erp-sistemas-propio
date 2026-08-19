"use client";

import ObservacionesBoard from "./ObservacionesBoard";
import type { QATabProps } from "./types";

/**
 * La pestaña QA tenía un segundo módulo acá arriba: el checklist jerárquico
 * original, con su propio toggle "Observaciones / Checklist". Se ocultó a
 * pedido — no se usaba —, pero el componente (`ChecklistView.tsx`) y sus rutas
 * de API (grupos/etapas/items) siguen intactos por si hace falta reactivarlo.
 */
export default function QATabRoot({ projectId, dataSchema, usuarios, projectTitle }: QATabProps) {
  return (
    <div className="space-y-4">
      <ObservacionesBoard
        projectId={projectId}
        dataSchema={dataSchema}
        usuarios={usuarios}
        projectTitle={projectTitle}
      />
    </div>
  );
}
