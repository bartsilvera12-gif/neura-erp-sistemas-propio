"use client";

import { MessageSquare } from "lucide-react";
import { useTicket } from "../../_ui/TicketContexto";
import ComentariosTicket from "../../_ui/ComentariosTicket";
import SubtareasTicket from "../../_ui/SubtareasTicket";
import { IconoTile } from "../../_ui/ui";

/**
 * Descripción del ticket: qué pasa, las revisiones de QA y la conversación del
 * equipo. La información clave va en la columna del marco (layout).
 */
export default function TicketDescripcionPage() {
  const { ticket: t, contadores } = useTicket();

  return (
    <div>
      <section className="rounded-xl border border-slate-200/80 bg-white px-5 py-4">
        <h3 className="text-[15px] font-bold text-slate-800">Descripción del problema</h3>
        {t.descripcion ? (
          <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-slate-600">{t.descripcion}</p>
        ) : (
          <p className="mt-2 text-[13px] italic text-slate-400">Sin descripción.</p>
        )}
      </section>

      <SubtareasTicket />

      <div id="comentarios" className="mt-5 flex scroll-mt-24 gap-3.5">
        <IconoTile icono={MessageSquare} tono="violeta" tam="sm" />
        <div className="min-w-0 flex-1">
          <h3 className="mb-3 text-[13.5px] font-bold text-slate-800">
            Comentarios{contadores.comentarios ? <span className="ml-1.5 font-semibold text-slate-400">{contadores.comentarios}</span> : null}
          </h3>
          <ComentariosTicket enTarjeta={false} />
        </div>
      </div>
    </div>
  );
}
