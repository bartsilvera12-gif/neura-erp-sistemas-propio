"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import ProyectoNuevoForm from "@/app/dashboard/proyectos/components/ProyectoNuevoForm";
import AsesorTabBar from "../../AsesorTabBar";

/**
 * Crear proyecto dentro de la app del asesor.
 *
 * El botón "Nuevo" iba a /dashboard/proyectos/nuevo y te sacaba de la app, igual que pasaba
 * con el detalle. `ProyectoNuevoForm` ya recibe `onCreated`/`onCancel`, así que se reusa el
 * formulario completo y solo se le cambia a dónde vuelve.
 *
 * Ojo con el orden de rutas: esta carpeta es hermana de `[id]`. Next resuelve primero el
 * segmento fijo, así que /m/asesor/proyectos/nuevo entra acá y no al detalle.
 */
export default function MAsesorProyectoNuevoPage() {
  const router = useRouter();

  return (
    <div className="flex h-svh min-h-0 flex-col bg-slate-50">
      <header
        className="z-10 flex shrink-0 items-center gap-1 bg-[#3F8E91] px-2 pb-2 text-white shadow-sm"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.5rem)" }}
      >
        <button
          type="button"
          onClick={() => router.push("/m/asesor/proyectos")}
          className="-ml-1 flex min-h-[40px] items-center gap-0.5 rounded-xl px-2 pr-3 text-[15px] font-medium active:bg-white/15"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
          Proyectos
        </button>
        <span className="ml-1 text-[15px] font-semibold">Nuevo proyecto</span>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3 py-4">
        <ProyectoNuevoForm
          variant="page"
          onCreated={(id) => router.push(`/m/asesor/proyectos/${id}`)}
          onCancel={() => router.push("/m/asesor/proyectos")}
        />
      </main>

      <AsesorTabBar />
    </div>
  );
}
