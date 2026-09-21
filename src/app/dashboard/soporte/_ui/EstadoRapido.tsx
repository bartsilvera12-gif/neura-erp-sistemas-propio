"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Hand, Loader2, Lock } from "lucide-react";
import { TRANSICIONES, enFranjaDeGuardia, mensajeEstadoFinal, puedeEstarACargo, requiereResponsable, transicionPermitida } from "@/lib/soporte/dominio";
import { useTicket } from "./TicketContexto";
import { apiSoporte } from "./api";
import { Aviso, Fase, TONO_AREA, oscurecer } from "./ui";
import { SelectorBuscable } from "./SelectorBuscable";
import { numeroTicket } from "@/lib/soporte/dominio";

/** Pista corta de lo que pasa al elegir cada estado. */
const PISTA: Record<string, string> = {
  listo_revision: "Abre una revisión para QA y le avisa",
  resuelto: "Requiere las subtareas finalizadas",
  cerrado: "Final: después no se puede cambiar",
  cancelado: "Final: después no se puede cambiar",
};

const ETIQUETA = "mb-1.5 block text-[12.5px] font-medium text-slate-500";
const CAJA =
  "flex h-11 w-full items-center gap-2.5 rounded-xl border bg-white px-3.5 text-[14px] font-semibold shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

/**
 * Estado y responsable del ticket, sin ventanas.
 *
 * "Estado del ticket" muestra dónde está y, al tocarlo, ofrece sólo los pasos
 * permitidos desde ahí. "A cargo" se guarda al elegirlo, con "Tomar" al lado.
 * Si un paso necesita responsable y no hay, se avisa acá mismo.
 */
export default function EstadoRapido() {
  const { ticket: t, catalogos, recargar } = useTicket();
  const [guardando, setGuardando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // En horario de guardia (sin QA) se puede resolver directo desde En proceso.
  const [guardia] = useState(() => enFranjaDeGuardia(Date.now()));
  const destinos = catalogos.estados.filter((e) => e.activo && transicionPermitida(t.estado_codigo, e.codigo, { guardia }));
  const final = mensajeEstadoFinal(t, t.estado_nombre);

  useEffect(() => {
    if (!abierto) return;
    const cerrar = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setAbierto(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(false);
    document.addEventListener("mousedown", cerrar);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", cerrar);
      document.removeEventListener("keydown", esc);
    };
  }, [abierto]);

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

  const pasarA = (d: (typeof destinos)[number]) => {
    setAbierto(false);
    if (requiereResponsable(d) && !t.responsable_id) {
      setError(`Para pasar a "${d.nombre}" elegí primero quién queda a cargo.`);
      return;
    }
    if (
      TRANSICIONES[d.codigo]?.length === 0 &&
      !window.confirm(`¿Pasar el ticket ${numeroTicket(t.numero)} a "${d.nombre}"? Después ya no se puede cambiar de estado.`)
    ) {
      return;
    }
    void guardar(d.codigo, { estado_codigo: d.codigo });
  };

  const yo = catalogos.personas.find((p) => p.id === catalogos.usuario_id);
  const puedoTomar = Boolean(yo && puedeEstarACargo(yo) && t.responsable_id !== yo.id && !final);

  const opcionesPersona = [
    { value: "", label: "Sin asignar" },
    // Desarrollo y QA; y quien ya estaba a cargo de antes, para que no desaparezca del selector.
    ...catalogos.personas.filter((p) => puedeEstarACargo(p) || p.id === t.responsable_id).map((p) => ({ value: p.id, label: p.nombre, detalle: p.area, tono: TONO_AREA[p.area] })),
  ];

  const cambiandoEstado = guardando != null && guardando !== "responsable";

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Estado: muestra dónde está y, al tocarlo, a qué se puede pasar. */}
        <div className="relative min-w-0" ref={menuRef}>
          <span className={ETIQUETA}>Estado del ticket</span>
          <button
            type="button"
            disabled={Boolean(final) || destinos.length === 0 || guardando != null}
            onClick={() => setAbierto((a) => !a)}
            aria-haspopup="listbox"
            aria-expanded={abierto}
            title={final ?? "Cambiar el estado"}
            className={`${CAJA} text-left transition enabled:hover:shadow-[0_2px_8px_-2px_rgba(15,23,42,0.12)] disabled:cursor-default`}
            style={{ borderColor: `${t.estado_color}66`, backgroundColor: `${t.estado_color}10` }}
          >
            {cambiandoEstado ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" style={{ color: t.estado_color }} aria-hidden />
            ) : (
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: t.estado_color }} aria-hidden />
            )}
            <span className="min-w-0 flex-1 truncate" style={{ color: oscurecer(t.estado_color) }}>
              {t.estado_nombre}
            </span>
            <Fase n={t.fase} />
            {final ? (
              <Lock className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
            ) : destinos.length ? (
              <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition ${abierto ? "rotate-180" : ""}`} aria-hidden />
            ) : null}
          </button>
          {abierto ? (
            <ul
              role="listbox"
              aria-label="Pasar a"
              className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-[0_12px_32px_-12px_rgba(15,23,42,0.35)]"
            >
              <li className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Pasar a</li>
              {destinos.map((d) => {
                const faltaResponsable = requiereResponsable(d) && !t.responsable_id;
                const pista = faltaResponsable
                  ? "Primero elegí quién queda a cargo"
                  : guardia && d.codigo === "resuelto" && t.estado_codigo !== "listo_revision"
                    ? "Horario de guardia: se resuelve sin revisión de QA"
                    : PISTA[d.codigo];
                return (
                  <li key={d.codigo}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => pasarA(d)}
                      className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left hover:bg-slate-50"
                    >
                      <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: d.color }} aria-hidden />
                      <span className="min-w-0">
                        <span className="block text-[13.5px] font-semibold text-slate-800">{d.nombre}</span>
                        {pista ? <span className="block text-[11.5px] text-slate-400">{pista}</span> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>

        {/* Quién lo tiene, y "Tomar" al lado. */}
        <div className="min-w-0">
          <span className={ETIQUETA}>A cargo</span>
          <div className="flex items-stretch gap-2">
            <div className="min-w-0 flex-1">
              <SelectorBuscable
                ariaLabel="A cargo"
                avatares
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
            {puedoTomar ? (
              <button
                type="button"
                disabled={guardando != null}
                onClick={() => void guardar("responsable", { responsable_id: yo?.id })}
                title="Asignarme este ticket"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[#4FAEB2]/40 bg-[#4FAEB2]/10 px-3.5 text-[13px] font-semibold text-[#2F6E71] transition hover:bg-[#4FAEB2]/20 disabled:opacity-60"
              >
                {guardando === "responsable" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Hand className="h-3.5 w-3.5" aria-hidden />}
                Tomar
              </button>
            ) : null}
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
