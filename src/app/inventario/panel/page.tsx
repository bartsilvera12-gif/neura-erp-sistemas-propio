import { redirect } from "next/navigation";

/** El "← Inventario" de las pantallas del 2.0 lleva a su panel; en Neura ese panel es Operaciones. */
export default function PanelInventario() {
  redirect("/panel/operaciones");
}
