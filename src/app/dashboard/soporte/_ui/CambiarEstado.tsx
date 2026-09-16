"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, X } from "lucide-react";
import { FancySelect } from "@/app/dashboard/proyectos/components/FancySelect";
import { eventoDeTransicion, requiereResponsable, transicionPermitida } from "@/lib/soporte/dominio";
import { apiSoporte } from "./api";
import { useTicket } from "./TicketContexto";
import { Aviso, Boton, Insignia, TONO_AREA, claseEtiqueta, claseInput } from "./ui";
import { SelectorBuscable } from "./SelectorBuscable";

/**
 * Cambio de estado del ticket.
 *
 * Ofrece sólo las transiciones del flujo oficial desde el estado actual, y pide
 * lo que cada una necesita: quién queda con la próxima acción, y —si QA
 * devuelve— qué observó. Así el ticket nunca avanza dejando un hueco que otro
 * tenga que adivinar.
 */
export default function CambiarEstado({ alCerrar }: { alCerrar: () => void }) {
  const { ticket, catalogos, recargar } = useTicket();
  const destinos = useMemo(
    () => catalogos.estados.filter((e) => e.activo && transicionPermitida(ticket.estado_codigo, e.codigo)),
    [catalogos, ticket.estado_codigo]
  );

  const [estado, setEstado] = useState(destinos[0]?.codigo ?? "");
  const [responsable, setResponsable] = useState(ticket.responsable_id ?? "");
  const [comentario, setComentario] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && !guardando && alCerrar();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [alCerrar, guardando]);

  const destino = catalogos.estados.find((e) => e.codigo === estado);
  const evento = estado ? eventoDeTransicion(ticket.estado_codigo, estado) : null;
  const esDevolucion = evento === "devolucion_qa";
  const pideResponsable = requiereResponsable(destino);

  // Sugerencia de responsable según el área del estado destino, sin imponerla.
  const sugeridos = useMemo(() => {
    const area = destino?.area ?? "";
    const personas = catalogos.personas;
    if (area.includes("QA")) return personas.filter((p) => p.es_qa);
    if (area.includes("Desarrollo")) return personas.filter((p) => p.es_tecnico);
    if (area.includes("PM")) return personas.filter((p) => p.es_project_manager);
    return [];
  }, [destino, catalogos.personas]);

  const opcionesPersona = [
    { value: "", label: "Sin asignar" },
    ...sugeridos.map((p) => ({ value: p.id, label: p.nombre, detalle: p.area, tono: TONO_AREA[p.area], sugerida: true })),
    ...catalogos.personas.filter((p) => !sugeridos.includes(p)).map((p) => ({ value: p.id, label: p.nombre, detalle: p.area, tono: TONO_AREA[p.area] })),
  ];

  const guardar = async () => {
    if (!estado) return;
    if (pideResponsable && !responsable) {
      setError(`Para pasar a "${destino?.nombre}" elegí quién queda con la próxima acción.`);
      return;
    }
    if (esDevolucion && !comentario.trim()) {
      setError("Explicá qué observó QA: es lo que va a leer Desarrollo al retomar.");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      await apiSoporte(`/api/soporte/tickets/${ticket.id}`, {
        method: "PATCH",
        json: {
          estado_codigo: estado,
          responsable_id: responsable || null,
          ...(esDevolucion ? { comentario } : {}),
        },
      });
      await recargar();
      alCerrar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cambiar el estado");
      setGuardando(false);
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[130] flex items-start justify-center bg-slate-900/35 p-4 pt-[12vh]"
      role="presentation"
      onClick={() => !guardando && alCerrar()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Cambiar estado"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-slate-900">Cambiar estado</h2>
          <button type="button" onClick={alCerrar} aria-label="Cerrar" className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {destinos.length === 0 ? (
            <Aviso tipo="info">Desde &ldquo;{ticket.estado_nombre}&rdquo; no hay pasos siguientes en el flujo.</Aviso>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <Insignia color={ticket.estado_color} punto>{ticket.estado_nombre}</Insignia>
                <ArrowRight className="h-4 w-4 text-slate-400" aria-hidden />
                <div className="min-w-[220px] flex-1">
                  <FancySelect
                    ariaLabel="Nuevo estado"
                    value={estado}
                    onChange={setEstado}
                    options={destinos.map((d) => ({ value: d.codigo, label: d.nombre, description: d.area ?? undefined }))}
                  />
                </div>
              </div>

              {esDevolucion ? (
                <div>
                  <span className={claseEtiqueta}>
                    Qué observó QA <span className="text-rose-500">*</span>
                  </span>
                  <textarea
                    className={`${claseInput} min-h-24 border-rose-200 focus:border-rose-300 focus:ring-rose-100`}
                    value={comentario}
                    onChange={(e) => setComentario(e.target.value)}
                    placeholder="Ej.: La factura se genera, pero el KuDE todavía no muestra el CDC."
                  />
                </div>
              ) : null}

              {estado === "listo_revision" ? (
                <Aviso tipo="info">Se abre una subtarea de revisión asignada a QA, que recibe el aviso.</Aviso>
              ) : estado === "resuelto" || estado === "cerrado" ? (
                <Aviso tipo="info">Sólo se puede si todas las subtareas están finalizadas.</Aviso>
              ) : null}

              <div>
                <span className={claseEtiqueta}>
                  Responsable{pideResponsable ? <span className="text-rose-500"> *</span> : null}
                </span>
                <SelectorBuscable ariaLabel="Responsable" avatares value={responsable} onChange={setResponsable} opciones={opcionesPersona} buscarPlaceholder="Buscar persona o área…" vacio="Nadie coincide" />
              </div>

            </>
          )}

          {error ? <Aviso>{error}</Aviso> : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <Boton variante="secundario" onClick={alCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton onClick={() => void guardar()} cargando={guardando} disabled={!estado || destinos.length === 0}>
            Cambiar estado
          </Boton>
        </div>
      </div>
    </div>,
    document.body
  );
}
