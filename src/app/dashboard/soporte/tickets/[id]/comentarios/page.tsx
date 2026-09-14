"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Paperclip, XCircle } from "lucide-react";
import { useTicket } from "../../../_ui/TicketContexto";
import { apiSoporte, fechaHora, subirArchivos, type Persona } from "../../../_ui/api";
import ZonaArchivos from "../../../_ui/ZonaArchivos";
import { Aviso, Avatar, Boton, Cargando, Tarjeta, Vacio, claseInput } from "../../../_ui/ui";

type Comentario = {
  id: string;
  contenido: string;
  es_rechazo_qa: boolean;
  created_at: string;
  autor: Persona | null;
  adjuntos: { id: string; nombre: string }[];
};

/**
 * Comentarios del ticket: sólo la conversación humana.
 *
 * Es otra cosa que el historial. Acá habla la gente; el historial es la
 * auditoría del sistema. Un comentario normal va liviano, sin caja; una
 * devolución de QA se destaca en rojo suave porque es lo que Desarrollo tiene
 * que leer primero al retomar.
 */
export default function TicketComentariosPage() {
  const { ticket, recargar } = useTicket();
  const [lista, setLista] = useState<Comentario[] | null>(null);
  const [texto, setTexto] = useState("");
  const [archivos, setArchivos] = useState<File[]>([]);
  const [adjuntando, setAdjuntando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finRef = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async () => {
    try {
      setLista(await apiSoporte<Comentario[]>(`/api/soporte/tickets/${ticket.id}/comentarios`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los comentarios");
    }
  }, [ticket.id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const comentar = async () => {
    const contenido = texto.trim();
    if (!contenido) return;
    setEnviando(true);
    setError(null);
    try {
      const creado = await apiSoporte<{ id: string }>(`/api/soporte/tickets/${ticket.id}/comentarios`, {
        method: "POST",
        json: { contenido },
      });
      if (archivos.length) {
        const r = await subirArchivos(ticket.id, archivos, { comentarioId: creado.id });
        if (r.errores.length) setError(`El comentario se guardó, pero no se subieron: ${r.errores.join(" · ")}`);
      }
      setTexto("");
      setArchivos([]);
      setAdjuntando(false);
      await Promise.all([cargar(), recargar()]);
      requestAnimationFrame(() => finRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo comentar");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Tarjeta>
      {lista == null ? (
        error ? <Aviso>{error}</Aviso> : <Cargando />
      ) : lista.length === 0 ? (
        <Vacio titulo="Todavía no hay comentarios" detalle="Usá los comentarios para la conversación del equipo sobre este ticket." />
      ) : (
        <ol className="relative space-y-5 before:absolute before:bottom-2 before:left-[17px] before:top-2 before:w-px before:bg-slate-100">
          {lista.map((c) => (
            <li key={c.id} className="relative flex gap-3">
              <span className="relative z-10 rounded-full ring-4 ring-white">
                <Avatar nombre={c.autor?.nombre} tam={35} />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="text-[13px]">
                  <span className="font-semibold text-slate-900">{c.autor?.nombre ?? "Usuario"}</span>
                  <span className="text-slate-400">
                    {" "}· {c.autor?.area ?? "Equipo"} · {fechaHora(c.created_at)}
                  </span>
                </p>
                {c.es_rechazo_qa ? (
                  <div className="mt-1.5 rounded-lg border border-rose-100 bg-rose-50/70 px-3 py-2">
                    <p className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-rose-600">
                      <XCircle className="h-3.5 w-3.5" aria-hidden /> No confirmado
                    </p>
                    <p className="mt-1 whitespace-pre-line text-[13.5px] leading-relaxed text-rose-900">{c.contenido}</p>
                  </div>
                ) : (
                  <p className="mt-1 whitespace-pre-line text-[13.5px] leading-relaxed text-slate-700">{c.contenido}</p>
                )}
                {c.adjuntos.length ? (
                  <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-slate-500">
                    <Paperclip className="h-3.5 w-3.5" aria-hidden />
                    {c.adjuntos.map((a) => a.nombre).join(", ")}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}

      <div ref={finRef} className="mt-6 space-y-3 border-t border-slate-100 pt-5">
        <textarea
          className={`${claseInput} min-h-24`}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void comentar();
          }}
          placeholder="Escribí un comentario…"
          disabled={enviando}
        />
        {adjuntando ? <ZonaArchivos archivos={archivos} onCambio={setArchivos} compacta deshabilitada={enviando} /> : null}
        {error && lista != null ? <Aviso>{error}</Aviso> : null}
        <div className="flex items-center justify-between gap-2">
          <Boton variante="fantasma" tam="sm" onClick={() => setAdjuntando((a) => !a)} disabled={enviando}>
            <Paperclip className="h-4 w-4" aria-hidden />
            {archivos.length ? `${archivos.length} adjunto(s)` : "Adjuntar archivo"}
          </Boton>
          <Boton onClick={() => void comentar()} cargando={enviando} disabled={!texto.trim()}>
            Comentar
          </Boton>
        </div>
      </div>
    </Tarjeta>
  );
}
