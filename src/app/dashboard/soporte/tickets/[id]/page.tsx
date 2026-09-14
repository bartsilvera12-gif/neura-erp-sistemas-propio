"use client";

import { useState } from "react";
import { useTicket } from "../../_ui/TicketContexto";
import CambiarEstado from "../../_ui/CambiarEstado";
import { fecha, fechaHora } from "../../_ui/api";
import { Avatar, Boton, Tarjeta } from "../../_ui/ui";

function Bloque({ titulo, texto, vacio }: { titulo: string; texto: string | null; vacio: string }) {
  return (
    <div>
      <h3 className="text-[13px] font-semibold text-slate-800">{titulo}</h3>
      {texto ? (
        <p className="mt-1.5 whitespace-pre-line text-[13.5px] leading-relaxed text-slate-600">{texto}</p>
      ) : (
        <p className="mt-1.5 text-[13px] italic text-slate-400">{vacio}</p>
      )}
    </div>
  );
}

function Fila({ etiqueta, valor }: { etiqueta: string; valor: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-[12.5px]">
      <span className="text-slate-500">{etiqueta}</span>
      <span className="min-w-0 truncate text-right font-medium text-slate-700">{valor || "—"}</span>
    </div>
  );
}

/**
 * Descripción del ticket: qué pasa, cómo reproducirlo y cómo se valida.
 *
 * Deliberadamente sin comentarios, archivos ni historial: cada uno tiene su
 * propia página. Esta es la ficha que se lee de corrido.
 */
export default function TicketDescripcionPage() {
  const { ticket: t } = useTicket();
  const [cambiando, setCambiando] = useState(false);
  const activo = t.estado_tipo === "abierto";

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <Tarjeta>
        <div className="space-y-6">
          <Bloque titulo="Descripción del problema" texto={t.descripcion} vacio="Sin descripción." />
          <Bloque titulo="Pasos para reproducir" texto={t.pasos_reproducir} vacio="No se cargaron pasos para reproducir." />
          <Bloque titulo="Resultado esperado" texto={t.resultado_esperado} vacio="No se indicó el resultado esperado." />
          <Bloque titulo="Impacto operativo" texto={t.impacto_operativo} vacio="No se indicó el impacto." />
          <Bloque titulo="Criterios de aceptación QA" texto={t.criterios_aceptacion} vacio="Sin criterios de validación definidos." />
        </div>
      </Tarjeta>

      <aside className="space-y-5">
        <Tarjeta titulo="Próxima acción">
          {t.responsable ? (
            <div className="flex items-center gap-3">
              <Avatar nombre={t.responsable.nombre} tam={38} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{t.responsable.nombre}</p>
                <p className="text-[12px] text-slate-500">{t.estado_area ?? t.responsable.area}</p>
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-slate-500">
              {activo ? "Nadie tiene la próxima acción todavía." : "El ticket está cerrado."}
            </p>
          )}
          <p className={`mt-3 text-[13px] leading-relaxed ${t.proxima_accion ? "text-slate-700" : "italic text-slate-400"}`}>
            {t.proxima_accion ?? "Sin acción definida."}
          </p>
          <Boton className="mt-4 w-full" onClick={() => setCambiando(true)}>
            Cambiar estado
          </Boton>
        </Tarjeta>

        <Tarjeta titulo="Información adicional" padding="px-5 py-3">
          <div className="divide-y divide-slate-100">
            <Fila etiqueta="Módulo" valor={t.modulo} />
            <Fila etiqueta="Proyecto" valor={t.proyecto_titulo} />
            <Fila etiqueta="Clasificación" valor={t.clasificacion_nombre} />
            <Fila etiqueta="Versión" valor={t.version} />
            <Fila etiqueta="Entorno" valor={t.entorno} />
            <Fila etiqueta="Navegador" valor={t.navegador} />
            <Fila etiqueta="Creado por" valor={t.creador?.nombre} />
            <Fila etiqueta="Fecha creación" valor={fechaHora(t.created_at)} />
            <Fila etiqueta="Fecha objetivo" valor={t.fecha_objetivo ? fecha(t.fecha_objetivo) : null} />
          </div>
        </Tarjeta>
      </aside>

      {cambiando ? <CambiarEstado alCerrar={() => setCambiando(false)} /> : null}
    </div>
  );
}
