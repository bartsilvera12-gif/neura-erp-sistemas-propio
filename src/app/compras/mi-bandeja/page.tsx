"use client";

/** Mi bandeja de compras (2.0 + datos de Neura) — Fase 5.3, por rol. */
import Pagina from "@/erp2/paginas/compras/mi-bandeja";
import { ProveedorErp2 } from "@/erp2/lib/sesion/ProveedorErp2";

export default function Page() {
  return (
    <ProveedorErp2>
      <Pagina />
    </ProveedorErp2>
  );
}
