"use client";

import Link from "next/link";
import ProyectosMobile from "@/mobile/pages/ProyectosMobile";
import { useMisModulos } from "@/shared/hooks/useMisModulos";
import AsesorTabBar from "../AsesorTabBar";

/**
 * Proyectos dentro de la app del asesor.
 *
 * Reusa tal cual `ProyectosMobile`, la misma pantalla que ya se ve entrando por el
 * navegador del celular a /dashboard/proyectos. No se duplica nada: si esa vista cambia,
 * esta cambia con ella. Acá solo se le pone alrededor el shell del asesor (la barra de
 * pestañas) y el control de acceso.
 *
 * El acceso se chequea también en el backend: /api/proyectos exige el módulo `proyectos`
 * (requireProyectosApiAccess). Este chequeo de acá es solo para no mostrar una pantalla
 * rota — no es la barrera de seguridad.
 */
export default function MAsesorProyectosPage() {
  const { tieneModulo } = useMisModulos();
  const habilitado = tieneModulo("proyectos_movil");

  return (
    <div className="min-h-svh bg-slate-50 flex flex-col">
      <main className="flex-1 overflow-y-auto overscroll-y-contain">
        {habilitado === null ? (
          <div className="p-6 text-center text-sm text-slate-400 animate-pulse">Cargando…</div>
        ) : habilitado ? (
          <ProyectosMobile />
        ) : (
          <div className="p-6 text-center text-sm text-slate-500">
            Tu usuario no tiene habilitada la vista de Proyectos.
            <Link href="/m/asesor" className="mt-3 block text-[#3F8E91] underline">
              Volver a mis conversaciones
            </Link>
          </div>
        )}
      </main>
      <AsesorTabBar />
    </div>
  );
}
