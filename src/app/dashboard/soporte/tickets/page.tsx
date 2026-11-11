"use client";

import Link from "next/link";
import { Suspense } from "react";
import { ListChecks, Plus } from "lucide-react";
import { PESTANAS_TICKETS } from "@/lib/soporte/dominio";
import GastoNeurita from "../_ui/GastoNeurita";
import TablaTickets from "../_ui/TablaTickets";
import { Cargando, Encabezado, Pagina, claseBoton } from "../_ui/ui";

export default function SoporteTicketsPage() {
  return (
    <Pagina>
      <Encabezado
        titulo="Tickets"
        subtitulo="Listado de tickets de soporte"
        icono={ListChecks}
        tono="celeste"
        acciones={
          <div className="flex flex-wrap items-center gap-3">
            <GastoNeurita />
            <Link href="/gestion-clientes" className={claseBoton("primario")} title="Los tickets se cargan desde la tipificación del cliente">
              <Plus className="h-4 w-4" aria-hidden /> Cargar ticket
            </Link>
          </div>
        }
      />
      <Suspense fallback={<Cargando />}>
        <TablaTickets pestanas={PESTANAS_TICKETS} />
      </Suspense>
    </Pagina>
  );
}
