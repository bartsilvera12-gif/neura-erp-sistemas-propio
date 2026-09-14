"use client";

import { useEffect } from "react";
import { precargarModulo } from "./api";

/**
 * Apenas se entra al módulo, trae en segundo plano lo que casi todas las
 * pantallas necesitan (catálogos, equipo, clientes). La primera pantalla lo usa
 * cuando llega, y las siguientes lo encuentran ya en memoria.
 */
export default function Precarga() {
  useEffect(() => {
    precargarModulo();
  }, []);
  return null;
}
