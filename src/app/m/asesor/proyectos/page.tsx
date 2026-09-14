"use client";

import Link from "next/link";
import ProyectosMobile from "@/mobile/pages/ProyectosMobile";
import { useMisModulos } from "@/shared/hooks/useMisModulos";
import AsesorTabBar from "../AsesorTabBar";

/**
 * Proyectos dentro de la app del asesor.
 *
 * Reusa `ProyectosMobile` — la misma pantalla que se ve entrando por el navegador del
 * celular a /dashboard/proyectos — con `variant="app"`, que es la que trae el encabezado
 * verde con safe area en vez de un simple título (sin eso quedaba tapado por el notch).
 * No se duplica nada: si esa vista cambia, esta cambia con ella.
 *
 * El layout es el mismo de la bandeja: contenedor flex a pantalla completa, encabezado y
 * barra de pestañas fijos arriba y abajo, y SOLO la lista scrollea en el medio. La variante
 * "app" aporta su propio <main> con el scroll, por eso acá no se envuelve.
 *
 * El acceso se chequea también en el backend: /api/proyectos exige el módulo `proyectos`
 * (requireProyectosApiAccess). Este chequeo es solo para no mostrar una pantalla rota.
 */
export default function MAsesorProyectosPage() {
  const { tieneModulo } = useMisModulos();
  const habilitado = tieneModulo("proyectos_movil");

  return (
    <div className="flex h-svh min-h-0 flex-col bg-slate-50">
      {habilitado === true ? (
        <ProyectosMobile variant="app" />
      ) : (
        <main className="min-h-0 flex-1 overflow-y-auto">
          {habilitado === null ? (
            <div className="p-6 text-center text-sm text-slate-400 animate-pulse">Cargando…</div>
          ) : (
            <div className="p-6 text-center text-sm text-slate-500">
              Tu usuario no tiene habilitada la vista de Proyectos.
              <Link href="/m/asesor" className="mt-3 block text-[#3F8E91] underline">
                Volver a mis conversaciones
              </Link>
            </div>
          )}
        </main>
      )}
      <AsesorTabBar />
    </div>
  );
}
