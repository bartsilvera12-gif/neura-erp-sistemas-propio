"use client";

/** Pantalla del ERP 2.0 tal cual (src/erp2), con los datos de Neura (/api/v2). */
import Pagina from "@/erp2/paginas/compras/lista";
import { ProveedorErp2 } from "@/erp2/lib/sesion/ProveedorErp2";

export default function Page() {
  return (
    <ProveedorErp2>
      <Pagina />
    </ProveedorErp2>
  );
}
