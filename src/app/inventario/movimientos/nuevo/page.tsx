import { redirect } from "next/navigation";

/**
 * La carga manual de movimientos se reemplazó por Ajustes y pérdidas: escribía el stock
 * desde el navegador y sin depósito. Quien entre por un enlace viejo llega al ajuste nuevo.
 */
export default function NuevoMovimientoPage() {
  redirect("/inventario/ajustes/nuevo");
}
