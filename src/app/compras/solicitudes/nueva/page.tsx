"use client";

/** Solicitud de compra (comercial): mismo formulario que la orden, en modo "solicitud". */
import Pagina from "@/erp2/paginas/compras/ordenes-nueva";
import { ProveedorErp2 } from "@/erp2/lib/sesion/ProveedorErp2";

export default function Page() {
  return (
    <ProveedorErp2>
      <Pagina modo="solicitud" />
    </ProveedorErp2>
  );
}
