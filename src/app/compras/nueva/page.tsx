import { redirect } from "next/navigation";

/**
 * La carga de compras pasó a un modal compacto dentro de la lista (/compras),
 * con el estilo del ERP. Esta ruta queda como redirección para no dejar accesible
 * la vista antigua ni romper enlaces guardados.
 */
export default function NuevaCompraRedirect() {
  redirect("/compras");
}
