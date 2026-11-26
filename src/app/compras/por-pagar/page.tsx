"use client";

/** Bandeja de pago de órdenes (2.0 + datos de Neura) — Fase 3. */
import Pagina from "@/erp2/paginas/compras/por-pagar";
import { ProveedorErp2 } from "@/erp2/lib/sesion/ProveedorErp2";

export default function Page() {
  return (
    <ProveedorErp2>
      <Pagina />
    </ProveedorErp2>
  );
}
