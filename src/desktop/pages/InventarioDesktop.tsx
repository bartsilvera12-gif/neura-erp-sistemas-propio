"use client";

/**
 * Inventario › Productos: la pantalla del ERP 2.0 tal cual (src/erp2), con los datos de Neura
 * (rutas /api/v2). Ver src/erp2/README.md.
 */
import InventarioPage from "@/erp2/paginas/inventario/Productos";
import { ProveedorErp2 } from "@/erp2/lib/sesion/ProveedorErp2";

export default function InventarioDesktop() {
  return (
    <ProveedorErp2>
      <InventarioPage />
    </ProveedorErp2>
  );
}
