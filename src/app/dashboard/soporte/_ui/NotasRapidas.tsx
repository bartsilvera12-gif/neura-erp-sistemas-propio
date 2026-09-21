"use client";

import { useState } from "react";
import { FileText, Info, Loader2 } from "lucide-react";
import { useTicket } from "./TicketContexto";
import { apiSoporte } from "./api";

/** Avisa a la lista de comentarios que hay uno nuevo para que se refresque. */
export const EVENTO_COMENTARIO_NUEVO = "soporte:comentario-nuevo";

/**
 * Nota interna rápida, desde la columna del ticket.
 *
 * Es un comentario del ticket como cualquier otro: queda en la conversación del
 * equipo y en el historial. Enter guarda; Shift+Enter baja de renglón.
 */
export default function NotasRapidas() {
  const { ticket, recargar } = useTicket();
  const [texto, setTexto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  const guardar = async () => {
    const contenido = texto.trim();
    if (!contenido || guardando) return;
    setGuardando(true);
    setAviso(null);
    try {
      await apiSoporte(`/api/soporte/tickets/${ticket.id}/comentarios`, { method: "POST", json: { contenido } });
      setTexto("");
      setAviso({ tipo: "ok", texto: "Nota guardada en los comentarios." });
      window.dispatchEvent(new CustomEvent(EVENTO_COMENTARIO_NUEVO, { detail: { ticketId: ticket.id } }));
      void recargar();
    } catch (e) {
      setAviso({ tipo: "error", texto: e instanceof Error ? e.message : "No se pudo guardar la nota" });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white px-5 py-4 shadow-[0_1px_3px_rgba(15,23,42,0.05),0_8px_24px_-12px_rgba(15,23,42,0.08)]">
      <h2 className="mb-3 text-[15px] font-bold text-slate-800">Notas rápidas</h2>
      <div className="relative">
        <FileText className="pointer-events-none absolute left-3.5 top-3.5 h-[18px] w-[18px] text-slate-300" aria-hidden />
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void guardar();
            }
          }}
          rows={3}
          disabled={guardando}
          placeholder="Agregar una nota interna…"
          className="w-full resize-none rounded-xl border border-slate-200 bg-white py-3 pl-11 pr-3 text-[14px] text-slate-700 placeholder:text-slate-400 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20 disabled:opacity-60"
        />
        {guardando ? <Loader2 className="absolute bottom-3 right-3 h-4 w-4 animate-spin text-[#4FAEB2]" aria-hidden /> : null}
      </div>
      {aviso ? (
        <p className={`mt-2 text-[12px] font-medium ${aviso.tipo === "ok" ? "text-emerald-600" : "text-rose-600"}`}>{aviso.texto}</p>
      ) : null}
      <p className="mt-3 flex items-center gap-1.5 text-[12px] text-slate-400">
        <Info className="h-3.5 w-3.5 shrink-0" aria-hidden /> Las notas son visibles solo para el equipo interno.
      </p>
    </section>
  );
}
