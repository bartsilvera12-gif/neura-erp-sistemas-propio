"use client";

/** Bandeja de solicitudes de compra (2.0 + datos de Neura). */
import Pagina from "@/erp2/paginas/compras/solicitudes";
import { ProveedorErp2 } from "@/erp2/lib/sesion/ProveedorErp2";

export default function Page() {
  return (
    <ProveedorErp2>
      <Pagina />
    </ProveedorErp2>
  );
}
