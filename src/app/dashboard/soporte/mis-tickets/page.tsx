"use client";

import { Suspense } from "react";
import { UserRoundCheck } from "lucide-react";
import TablaTickets, { type PestanaDef } from "../_ui/TablaTickets";
import { Cargando, Encabezado, Pagina } from "../_ui/ui";

/**
 * Pestañas de "Mis tickets": agrupan por lo que la persona tiene que HACER.
 * "En revisión" es lo que ya entregó; "Por revisar", las revisiones de QA
 * asignadas a quien mira.
 */
const PESTANAS: readonly PestanaDef[] = [
  { id: "pendientes", etiqueta: "Pendientes", estados: ["pendiente"] },
  { id: "en_proceso", etiqueta: "En proceso", estados: ["en_proceso", "reabierto"] },
  { id: "falta_informacion", etiqueta: "Falta información", estados: ["falta_informacion"] },
  { id: "revision", etiqueta: "En revisión", estados: ["listo_revision"] },
  // Lo que me toca revisar como QA: por subtarea asignada, no por responsable.
  { id: "por_revisar", etiqueta: "Por revisar", estados: null, revision: true },
  { id: "resueltos", etiqueta: "Resueltos", estados: ["resuelto"] },
];

export default function SoporteMisTicketsPage() {
  return (
    <Pagina>
      <Encabezado titulo="Mis tickets" subtitulo="Los tickets donde tenés la próxima acción" icono={UserRoundCheck} tono="violeta" />
      <Suspense fallback={<Cargando />}>
        <TablaTickets pestanas={PESTANAS} soloMios ocultarResponsable />
      </Suspense>
    </Pagina>
  );
}
