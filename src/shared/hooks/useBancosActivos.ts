"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";

export type BancoOpcion = { id: string; nombre: string };

/**
 * Lista de bancos ACTIVOS de la empresa (catálogo de Configuración → Bancos).
 * Alimenta el desplegable "Banco de origen" de los botones de cobro. Se carga
 * cuando `enabled` es true (p. ej. al abrir el modal), no en cada render.
 */
export function useBancosActivos(enabled: boolean): { bancos: BancoOpcion[]; loading: boolean } {
  const [bancos, setBancos] = useState<BancoOpcion[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancel = false;
    setLoading(true);
    apiFetch("/api/configuracion/bancos", { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as {
          data?: { bancos?: { id: string; nombre: string; activo: boolean }[] };
        };
        if (cancel) return;
        const list = j?.data?.bancos ?? [];
        setBancos(list.filter((b) => b.activo).map((b) => ({ id: b.id, nombre: b.nombre })));
      })
      .catch(() => {
        if (!cancel) setBancos([]);
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [enabled]);

  return { bancos, loading };
}
