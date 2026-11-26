import type { ClienteConfig } from "@/erp2/modules/types";

/** Neura: las pantallas del 2.0 dentro del sistema propio. El color real sale del tema (--brand). */
export const clienteConfig: ClienteConfig = {
  nombre: "Neura",
  dominio: "sistemas.neura.com.py",
  color: "#4FAEB2",
  modulos: ["caja", "inventario", "gastos-empresariales", "reportes", "configuracion"],
  logo: "/brand/neura-consultora.png",
};
