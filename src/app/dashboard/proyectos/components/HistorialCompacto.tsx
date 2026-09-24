"use client";

import { paletaEstado } from "@/app/dashboard/proyectos/components/HistorialLinea";

type Evento = Record<string, unknown>;

/**
 * Línea de tiempo COMPACTA (una fila) para el desplegable del tablero. Muestra
 * sólo la secuencia de estados (cambios de estado), de más viejo a más nuevo,
 * como chips de color con el tiempo en cada uno. No incluye reasignaciones ni
 * sub-etapas: para eso está la pestaña Historial completa de la ficha.
 */
export function HistorialCompacto({ eventos }: { eventos: Evento[] }) {
  const estados = eventos.filter((e) => e.evento_tipo === "estado" || e.evento_tipo == null);

  if (estados.length === 0) {
    return <p className="text-[11px] text-slate-400">Sin cambios de estado registrados.</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px]">
      {estados.map((h, i) => {
        const nombre =
          (h.estado_nuevo_nombre as string | undefined) ?? String(h.estado_nuevo_id ?? "—");
        const pal = paletaEstado(nombre);
        const abierto = !h.exited_at;
        const durCruda = String(h.duration_label ?? "").trim();
        const duracion = durCruda && durCruda !== "—" ? durCruda : "";
        return (
          <span key={String(h.id ?? i)} className="inline-flex items-center gap-1.5">
            {i > 0 ? <span className="text-slate-300">→</span> : null}
            <span
              className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-medium ${pal.chip}`}
            >
              {nombre}
              {abierto ? (
                <span className="opacity-70">· actual</span>
              ) : duracion ? (
                <span className="opacity-70">· {duracion}</span>
              ) : null}
            </span>
          </span>
        );
      })}
    </div>
  );
}
