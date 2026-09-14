"use client";

import { Suspense } from "react";
import TablaTickets, { type PestanaDef } from "../_ui/TablaTickets";
import { Cargando, Encabezado, Pagina } from "../_ui/ui";

/**
 * Pestañas de "Mis tickets": agrupan por lo que la persona tiene que HACER, no
 * por el flujo completo. "Esperando QA" es lo que ya entregó y espera respuesta.
 */
const PESTANAS: readonly PestanaDef[] = [
  { id: "abiertos", etiqueta: "Abiertos", estados: ["registrado", "clasificado"] },
  { id: "desarrollo", etiqueta: "En desarrollo", estados: ["en_desarrollo"] },
  { id: "qa", etiqueta: "Esperando QA", estados: ["en_qa"] },
  { id: "observaciones", etiqueta: "Con observaciones", estados: ["con_observaciones"] },
  { id: "resueltos", etiqueta: "Resueltos", estados: ["resuelto"] },
];

export default function SoporteMisTicketsPage() {
  return (
    <Pagina>
      <Encabezado titulo="Mis tickets" subtitulo="Los tickets donde tenés la próxima acción" />
      <Suspense fallback={<Cargando />}>
        <TablaTickets pestanas={PESTANAS} soloMios ocultarResponsable />
      </Suspense>
    </Pagina>
  );
}
