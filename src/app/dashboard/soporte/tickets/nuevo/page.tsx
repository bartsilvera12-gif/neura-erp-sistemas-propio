import { redirect } from "next/navigation";

/**
 * El alta directa de tickets se cerró: nacen de la tipificación del cliente
 * (Gestión de clientes) o del botón Soporte de Conversaciones. Un enlace viejo
 * a esta página lleva a Gestión de clientes.
 */
export default function SoporteNuevoTicketPage() {
  redirect("/gestion-clientes");
}
