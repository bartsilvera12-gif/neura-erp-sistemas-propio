"use client";

import { useState } from "react";
import { ArrowRight, Hand, Loader2, Lock, UserRound } from "lucide-react";
import { TRANSICIONES, enFranjaDeGuardia, mensajeEstadoFinal, puedeEstarACargo, requiereResponsable, transicionPermitida } from "@/lib/soporte/dominio";
import { useTicket } from "./TicketContexto";
import { apiSoporte } from "./api";
import { Aviso, TONO_AREA } from "./ui";
import { SelectorBuscable } from "./SelectorBuscable";

/** Pista corta de lo que pasa al elegir cada estado. */
const PISTA: Record<string, string> = {
  listo_revision: "Abre una revisión para QA y le avisa",
  resuelto: "Requiere las subtareas finalizadas",
  cerrado: "Final: después no se puede cambiar",
  cancelado: "Final: después no se puede cambiar",
};

/**
 * Estado y responsable del ticket, a un clic y sin ventanas.
 *
 * Los botones son sólo los pasos permitidos desde el estado actual; el
 * responsable se cambia en el mismo lugar y se guarda al elegirlo. Si un paso
 * necesita responsable y no hay, se avisa acá mismo.
 */
export default function EstadoRapido() {
  const { ticket: t, catalogos, recargar } = useTicket();
  const [guardando, setGuardando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // En horario de guardia (sin QA) se puede resolver directo desde En proceso.
  const [guardia] = useState(() => enFranjaDeGuardia(Date.now()));
  const destinos = catalogos.estados.filter((e) => e.activo && transicionPermitida(t.estado_codigo, e.codigo, { guardia }));
  const final = mensajeEstadoFinal(t, t.estado_nombre);

  const guardar = async (clave: string, json: Record<string, unknown>) => {
    setGuardando(clave);
    setError(null);
    try {
      await apiSoporte(`/api/soporte/tickets/${t.id}`, { method: "PATCH", json });
      await recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(null);
    }
  };

  const yo = catalogos.personas.find((p) => p.id === catalogos.usuario_id);
  const puedoTomar = Boolean(yo && puedeEstarACargo(yo) && t.responsable_id !== yo.id && !final);

  const opcionesPersona = [
    { value: "", label: "Sin asignar" },
    // Desarrollo y QA; y quien ya estaba a cargo de antes, para que no desaparezca del selector.
    ...catalogos.personas.filter((p) => puedeEstarACargo(p) || p.id === t.responsable_id).map((p) => ({ value: p.id, label: p.nombre, detalle: p.area, tono: TONO_AREA[p.area] })),
  ];

  return (
    <div className="mt-4 border-t border-slate-200/70 pt-3.5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {final ? (
            <span className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-[13px] font-semibold text-slate-600">
              <Lock className="h-4 w-4 shrink-0" aria-hidden /> {final}
            </span>
          ) : (
            <>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Pasar a</span>
              {destinos.map((d) => {
                const cargando = guardando === d.codigo;
                const faltaResponsable = requiereResponsable(d) && !t.responsable_id;
                return (
                  <button
                    key={d.codigo}
                    type="button"
                    disabled={guardando != null}
                    title={
                      faltaResponsable
                        ? "Primero elegí quién queda a cargo"
                        : guardia && d.codigo === "resuelto" && t.estado_codigo !== "listo_revision"
                          ? "Horario de guardia: se resuelve sin revisión de QA"
                          : PISTA[d.codigo]
                    }
                    onClick={() =>
                      faltaResponsable
                        ? setError(`Para pasar a "${d.nombre}" elegí primero quién queda a cargo.`)
                        : TRANSICIONES[d.codigo]?.length === 0 &&
                            !window.confirm(`¿Pasar el ticket #${t.numero} a "${d.nombre}"? Después ya no se puede cambiar de estado.`)
                          ? undefined
                          : void guardar(d.codigo, { estado_codigo: d.codigo })
                    }
                    className="group inline-flex items-center gap-1.5 rounded-xl border bg-white px-3 py-1.5 text-[13px] font-semibold shadow-sm transition hover:-translate-y-px hover:shadow disabled:translate-y-0 disabled:opacity-60"
                    style={{ borderColor: `${d.color}66`, color: d.color }}
                  >
                    {cargando ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" aria-hidden />
                    )}
                    <span className="text-slate-700">{d.nombre}</span>
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: d.color }} aria-hidden />
                  </button>
                );
              })}
            </>
          )}
        </div>

        <div className="flex w-full items-center gap-2 sm:w-[21rem]">
          <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
            <UserRound className="h-3.5 w-3.5" aria-hidden /> A cargo
          </span>
          {puedoTomar ? (
            <button
              type="button"
              disabled={guardando != null}
              onClick={() => void guardar("responsable", { responsable_id: yo?.id })}
              title="Asignarme este ticket"
              className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[#4FAEB2] px-2.5 py-1.5 text-[11.5px] font-bold text-white shadow-sm hover:bg-[#3F8E91] disabled:opacity-60"
            >
              <Hand className="h-3.5 w-3.5" aria-hidden /> Tomar
            </button>
          ) : null}
          <div className="min-w-0 flex-1">
            <SelectorBuscable
              ariaLabel="A cargo"
              avatares
              tam="sm"
              value={t.responsable_id ?? ""}
              disabled={guardando != null}
              onChange={(v) => {
                if ((v || null) !== t.responsable_id) void guardar("responsable", { responsable_id: v || null });
              }}
              opciones={opcionesPersona}
              buscarPlaceholder="Buscar persona o área…"
              vacio="Nadie coincide"
            />
          </div>
        </div>
      </div>
      {error ? (
        <div className="mt-3">
          <Aviso>{error}</Aviso>
        </div>
      ) : null}
    </div>
  );
}
