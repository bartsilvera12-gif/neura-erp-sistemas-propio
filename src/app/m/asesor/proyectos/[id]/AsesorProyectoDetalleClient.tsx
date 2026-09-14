"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import ProyectoDetalleInner from "@/app/dashboard/proyectos/components/ProyectoDetalleInner";
import AsesorTabBar from "../../AsesorTabBar";

/**
 * Se usa `variant="modal"` y no "page" a propósito. "page" guarda la solapa activa en la
 * URL con `router.replace("/dashboard/proyectos/...")` — o sea que tocar una solapa te
 * sacaba de la app. "modal" la guarda en estado interno, trae su propio scroll y ya expone
 * `onClose`, que acá vuelve al listado de la app en vez de al Kanban.
 *
 * La barra verde de arriba existe por el notch: el encabezado blanco del detalle quedaría
 * abajo de la barra de estado del iPhone. También es la única forma de volver sin depender
 * del gesto de deslizar.
 */
export default function AsesorProyectoDetalleClient({
  params,
  dataSchema,
}: {
  params: Promise<{ id: string }>;
  dataSchema: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  /* Un aviso de comentario abre directo esa solapa (?tab=comentarios). En "modal" la solapa
     inicial se pasa por prop, no por URL — la URL es lo que sacaba de la app. */
  const [id, setId] = useState<string>("");

  useEffect(() => {
    void params.then((p) => setId(p.id));
  }, [params]);

  const volver = () => router.push("/m/asesor/proyectos");

  return (
    <div className="flex h-svh min-h-0 flex-col bg-white">
      <header
        className="z-10 flex shrink-0 items-center gap-1 bg-[#3F8E91] px-2 pb-2 text-white shadow-sm"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.5rem)" }}
      >
        <button
          type="button"
          onClick={volver}
          className="-ml-1 flex min-h-[40px] items-center gap-0.5 rounded-xl px-2 pr-3 text-[15px] font-medium active:bg-white/15"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
          Proyectos
        </button>
      </header>

      <div className="min-h-0 flex-1">
        {id ? (
          <ProyectoDetalleInner
            projectId={id}
            variant="modal"
            dataSchema={dataSchema}
            initialTab={sp?.get("tab") ?? undefined}
            onClose={volver}
          />
        ) : (
          <div className="p-6 text-center text-sm text-slate-400 animate-pulse">Cargando…</div>
        )}
      </div>

      <AsesorTabBar />
    </div>
  );
}
