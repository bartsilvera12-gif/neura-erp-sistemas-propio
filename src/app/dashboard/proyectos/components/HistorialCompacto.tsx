"use client";

import { paletaEstado } from "@/app/dashboard/proyectos/components/HistorialLinea";

type Evento = Record<string, unknown>;

/** "22/09 15:34" en hora de Paraguay. */
function fechaHoraCorta(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return new Intl.DateTimeFormat("es-PY", {
    timeZone: "America/Asuncion",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/**
 * Historial COMPACTO para el desplegable del tablero: una fila por cambio de
 * estado (más reciente arriba), con el estado anterior → el nuevo (con su
 * color), el tiempo que estuvo, cuándo y quién. Es el resumen; el detalle
 * completo (reasignaciones, sub-etapas) vive en la pestaña Historial de la ficha.
 */
export function HistorialCompacto({ eventos }: { eventos: Evento[] }) {
  const estados = eventos.filter((e) => e.evento_tipo === "estado" || e.evento_tipo == null);

  if (estados.length === 0) {
    return <p className="text-[11px] text-slate-400">Sin cambios de estado registrados.</p>;
  }

  // Más reciente primero (los eventos vienen del más viejo al más nuevo).
  const filas = [...estados].reverse();

  return (
    <div className="divide-y divide-slate-100">
      {filas.map((h, i) => {
        const nuevo = (h.estado_nuevo_nombre as string | undefined) ?? String(h.estado_nuevo_id ?? "—");
        const anterior = (h.estado_anterior_nombre as string | undefined) ?? "Alta del proyecto";
        const pal = paletaEstado(nuevo);
        const abierto = !h.exited_at;
        const durCruda = String(h.duration_label ?? "").trim();
        const duracion = durCruda && durCruda !== "—" ? durCruda : "";
        const usuario = (h.usuario_cambio_label as string | undefined) ?? "";
        const cuando = fechaHoraCorta(String(h.entered_at ?? ""));
        return (
          <div
            key={String(h.id ?? i)}
            className="flex items-center justify-between gap-3 py-1 text-[11px]"
          >
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className="max-w-[130px] truncate text-slate-400">{anterior}</span>
              <span className="text-slate-300">→</span>
              <span
                className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 font-medium ${pal.chip}`}
              >
                {nuevo}
              </span>
              <span className={`shrink-0 ${abierto ? "font-medium text-[#2F6E71]" : "text-slate-400"}`}>
                {abierto ? "· actual" : duracion ? `· ${duracion}` : ""}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-slate-400">
              <span className="tabular-nums">{cuando}</span>
              {usuario && usuario !== "—" && usuario !== "No registrado" ? (
                <span className="hidden max-w-[130px] truncate sm:inline">{usuario}</span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
