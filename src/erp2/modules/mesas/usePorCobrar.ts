"use client";

/**
 * Mesas por cobrar (receta 69) para Caja › Nueva venta: pide /api/mesas/por-cobrar?caja=<id>
 * cada `cadaMs` mientras la pestaña está a la vista (stale-while-revalidate) y avisa con
 * `onNuevas` las cuentas que entraron desde la última consulta (la primera carga no avisa).
 * `fresco` = la lista viene del servidor en esta vuelta (no del cache): solo entonces se puede
 * concluir que una cuenta "ya no está".
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetchSWR, guardadoAlInstante } from "@/erp2/lib/api/cache-cliente";
import { urlPorCobrar, type CuentaPorCobrar, type MesasPorCobrar } from "@/erp2/modules/mesas/tipos";

export function usePorCobrar(cajaId: string | null, onNuevas?: (c: CuentaPorCobrar[]) => void, cadaMs = 4000) {
  const url = cajaId ? urlPorCobrar(cajaId) : null;
  const [datos, setDatos] = useState<MesasPorCobrar | null>(() => (url ? guardadoAlInstante<MesasPorCobrar>(url) ?? null : null));
  const [fresco, setFresco] = useState(false);
  const vistas = useRef<Set<string> | null>(null);
  const aviso = useRef(onNuevas);
  aviso.current = onNuevas;
  const [desfase, setDesfase] = useState(0);

  const recibir = useCallback((d: MesasPorCobrar, viejo: boolean) => {
    setDatos(d);
    if (!viejo) { setFresco(true); setDesfase(Date.parse(d.ahora) - Date.now()); }
    const ids = d.cuentas.map((c) => c.id);
    if (vistas.current === null) { vistas.current = new Set(ids); return; }
    const llegadas = d.cuentas.filter((c) => !vistas.current!.has(c.id));
    vistas.current = new Set(ids);
    if (llegadas.length && !viejo) aviso.current?.(llegadas);
  }, []);

  const pedir = useCallback(async (signal?: AbortSignal) => {
    if (!url) return;
    try { await apiFetchSWR<MesasPorCobrar>(url, recibir, { fresco: true, signal }); } catch { /* reintenta en la próxima vuelta */ }
  }, [url, recibir]);

  useEffect(() => {
    vistas.current = null;
    setFresco(false);
    if (!url) { setDatos(null); return; }
    const ctrl = new AbortController();
    const hit = guardadoAlInstante<MesasPorCobrar>(url);
    if (hit) recibir(hit, true);
    // Un solo pedido a la vez: con la red lenta (respuesta > cadaMs) no se encima otro.
    let enCurso = false;
    const tic = () => {
      if (enCurso || document.visibilityState !== "visible") return;
      enCurso = true;
      void pedir(ctrl.signal).finally(() => { enCurso = false; });
    };
    void pedir(ctrl.signal);
    const id = setInterval(tic, cadaMs);
    const alVolver = tic;
    document.addEventListener("visibilitychange", alVolver);
    return () => { ctrl.abort(); clearInterval(id); document.removeEventListener("visibilitychange", alVolver); };
  }, [url, cadaMs, pedir, recibir]);

  return { cuentas: datos?.cuentas ?? [], cargado: !!datos, fresco, recargar: () => pedir(), ahora: () => Date.now() + desfase };
}
