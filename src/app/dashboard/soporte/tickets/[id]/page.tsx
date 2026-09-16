"use client";

import Link from "next/link";
import { FileText, Info, MessageSquare, type LucideIcon } from "lucide-react";
import { useTicket } from "../../_ui/TicketContexto";
import AccesosProyecto from "../../_ui/AccesosProyecto";
import ComentariosTicket from "../../_ui/ComentariosTicket";
import SubtareasTicket from "../../_ui/SubtareasTicket";
import { fechaHora } from "../../_ui/api";
import { IconoTile, Tarjeta, type Tono } from "../../_ui/ui";

function Bloque({ titulo, texto, vacio, icono, tono }: { titulo: string; texto: string | null; vacio: string; icono: LucideIcon; tono: Tono }) {
  return (
    <div className="flex gap-3.5">
      <IconoTile icono={icono} tono={tono} tam="sm" />
      <div className="min-w-0 flex-1 border-b border-slate-100 pb-5">
        <h3 className="text-[13.5px] font-bold text-slate-800">{titulo}</h3>
        {texto ? (
          <p className="mt-1.5 whitespace-pre-line text-[14px] leading-relaxed text-slate-600">{texto}</p>
        ) : (
          <p className="mt-1.5 text-[13px] italic text-slate-400">{vacio}</p>
        )}
      </div>
    </div>
  );
}

function Fila({ etiqueta, valor }: { etiqueta: string; valor: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 text-[12.5px]">
      <span className="font-medium text-slate-500">{etiqueta}</span>
      <span className="min-w-0 truncate text-right font-semibold text-slate-700">{valor || "—"}</span>
    </div>
  );
}

/**
 * Descripción del ticket: qué pasa y la conversación del equipo. Sin
 * archivos ni historial: cada uno tiene su propia página.
 */
export default function TicketDescripcionPage() {
  const { ticket: t, contadores } = useTicket();

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_330px]">
      <Tarjeta>
        <Bloque titulo="Descripción del problema" texto={t.descripcion} vacio="Sin descripción." icono={FileText} tono="turquesa" />
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
      </Tarjeta>

      <aside className="min-w-0 space-y-5">
        <Tarjeta titulo="Información adicional" icono={Info} tono="indigo" padding="px-5 py-2">
          <div className="divide-y divide-slate-100">
            <Fila etiqueta="Módulo" valor={t.modulo} />
            <Fila
              etiqueta="Proyecto"
              valor={
                t.proyecto_id ? (
                  <Link href={`/dashboard/proyectos/${t.proyecto_id}`} className="text-[#2F6E71] no-underline hover:underline">{t.proyecto_titulo ?? "Ver proyecto"}</Link>
                ) : null
              }
            />
            <Fila
              etiqueta="Origen"
              valor={
                t.origen === "tipificacion_cliente" && t.cliente_id ? (
                  <Link href={`/clientes/${t.cliente_id}/tipificacion${t.tipificacion_id ? `#tip-${t.tipificacion_id}` : ""}`} className="text-[#2F6E71] no-underline hover:underline">
                    Tipificación de cliente
                  </Link>
                ) : t.origen === "manual" ? "Alta en Soporte" : null
              }
            />
            <Fila etiqueta="Clasificación" valor={t.clasificacion_nombre} />
            <Fila etiqueta="Creado por" valor={t.creador?.nombre} />
            <Fila etiqueta="Fecha creación" valor={fechaHora(t.created_at)} />
            <Fila etiqueta="Fecha objetivo" valor={t.fecha_objetivo ? fechaHora(t.fecha_objetivo) : null} />
          </div>
        </Tarjeta>

        {t.proyecto_id ? (
          <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.05),0_8px_24px_-12px_rgba(15,23,42,0.08)]">
            {/* En vivo desde el proyecto, con el permiso de Proyectos: el ticket no guarda credenciales. */}
            <AccesosProyecto proyectoId={t.proyecto_id} compacto />
          </section>
        ) : null}
      </aside>

    </div>
  );
}
