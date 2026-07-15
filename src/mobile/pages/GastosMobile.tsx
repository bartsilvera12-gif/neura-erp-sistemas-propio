"use client";

import GastosServiciosClient from "@/app/gastos/GastosServiciosClient";

/** Gastos y Servicios (móvil). Reutiliza el cliente responsive. */
export default function GastosMobile() {
  return (
    <div className="px-3 py-4">
      <GastosServiciosClient />
    </div>
  );
}
