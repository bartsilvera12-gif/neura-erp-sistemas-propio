"use client";

/** Tope de cuotas y planes de cuotas de la empresa (receta 131), con cache. Sin datos: 120 y sin planes. */
import { useEffect, useState } from "react";
import { apiFetchCache } from "@/erp2/lib/api/cache-cliente";
import type { PlanesCuota } from "@/erp2/modules/caja/cuotas";

export const PLANES_VACIO: PlanesCuota = { max_cuotas: 120, planes: [] };

export function usePlanesCuota(): PlanesCuota {
  const [d, setD] = useState<PlanesCuota>(PLANES_VACIO);
  useEffect(() => {
    let vivo = true;
    apiFetchCache<PlanesCuota>("/api/cuotas/planes").then((x) => { if (vivo) setD(x); }).catch(() => {});
    return () => { vivo = false; };
  }, []);
  return d;
}
