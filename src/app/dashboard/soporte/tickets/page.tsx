"use client";

import Link from "next/link";
import { Suspense } from "react";
import { ListChecks, Plus } from "lucide-react";
import { PESTANAS_TICKETS } from "@/lib/soporte/dominio";
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
          <Link href="/dashboard/soporte/tickets/nuevo" className={claseBoton("primario")}>
            <Plus className="h-4 w-4" aria-hidden /> Nuevo ticket
          </Link>
        }
      />
      <Suspense fallback={<Cargando />}>
        <TablaTickets pestanas={PESTANAS_TICKETS} />
      </Suspense>
    </Pagina>
  );
}
