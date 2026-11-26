"use client";

/** Roles del flujo de compra (2.0 + datos de Neura) — Fase 5.2, solo admin. */
import Pagina from "@/erp2/paginas/compras/roles";
import { ProveedorErp2 } from "@/erp2/lib/sesion/ProveedorErp2";

export default function Page() {
  return (
    <ProveedorErp2>
      <Pagina />
    </ProveedorErp2>
  );
}
