"use client";

import {
  qaCodigoObservacion,
  qaEstadoLabel,
  qaSeveridadColor,
  qaSeveridadLabel,
} from "@/lib/proyectos/qa-observaciones-config";
import type { QAObservacion, QASeccion } from "./types";
import {
  IconCheck,
  IconClock,
  IconImage,
  IconMessage,
  estaVencida,
  fechaCorta,
  iniciales,
  textoSobre,
} from "./ui";

type Props = {
  obs: QAObservacion;
  seccion: QASeccion | null;
  onAbrir: (obs: QAObservacion) => void;
  onToggleResuelto: (obs: QAObservacion) => void;
};

const ESTADO_CHIP: Record<string, string> = {
  pendiente: "bg-amber-50 text-amber-700 border-amber-200",
  en_curso: "bg-sky-50 text-sky-700 border-sky-200",
  resuelto: "bg-emerald-50 text-emerald-700 border-emerald-200",
  verificado: "bg-[#4FAEB2]/10 text-[#3F8E91] border-[#4FAEB2]/30",
  descartado: "bg-slate-100 text-slate-500 border-slate-200",
};

export default function ObservacionCard({ obs, seccion, onAbrir, onToggleResuelto }: Props) {
  const cerrada = obs.estado === "resuelto" || obs.estado === "verificado" || obs.estado === "descartado";
  const marcada = obs.estado === "resuelto" || obs.estado === "verificado";
  const portada = obs.archivos.find((a) => (a.mime_type ?? "").startsWith("image/") && a.url);
  const vencida = !cerrada && estaVencida(obs.fecha_limite);
  const colorSeccion = seccion?.color ?? null;

  return (
    <li
      className={`group flex items-start gap-3 rounded-2xl border bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors sm:p-3.5 ${
        cerrada ? "border-slate-200/70 opacity-70" : "border-slate-200 hover:border-[#4FAEB2]/50"
      }`}
    >
      {/* Checkbox grande: resuelve (o reabre) de un solo click. */}
      <button
        type="button"
        onClick={() => onToggleResuelto(obs)}
        aria-pressed={marcada}
        aria-label={marcada ? `Reabrir ${qaCodigoObservacion(obs.numero)}` : `Marcar ${qaCodigoObservacion(obs.numero)} como resuelta`}
        title={marcada ? "Reabrir" : "Marcar resuelta"}
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 transition-colors ${
          marcada
            ? "border-[#4FAEB2] bg-[#4FAEB2] text-white"
            : "border-slate-300 text-transparent hover:border-[#4FAEB2] hover:text-[#4FAEB2]/40"
        }`}
      >
        <IconCheck size={15} />
      </button>

      <button
        type="button"
        onClick={() => onAbrir(obs)}
        className="min-w-0 flex-1 text-left"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-slate-600">
            {qaCodigoObservacion(obs.numero)}
          </span>

          {seccion ? (
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-medium"
              style={
                colorSeccion
                  ? { backgroundColor: colorSeccion, color: textoSobre(colorSeccion) }
                  : { backgroundColor: "#f1f5f9", color: "#475569" }
              }
            >
              {seccion.nombre}
            </span>
          ) : null}

          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white"
            style={{ backgroundColor: qaSeveridadColor(obs.severidad) }}
          >
            {qaSeveridadLabel(obs.severidad)}
          </span>

          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              ESTADO_CHIP[obs.estado] ?? ESTADO_CHIP.pendiente
            }`}
          >
            {qaEstadoLabel(obs.estado)}
          </span>

          {obs.origen === "cliente" ? (
            <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700">
              Cliente
            </span>
          ) : null}
        </div>

        <p
          className={`mt-1.5 text-sm font-medium ${
            marcada ? "text-slate-500 line-through decoration-slate-300" : "text-slate-900"
          }`}
        >
          {obs.titulo}
        </p>

        {obs.descripcion ? (
          <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{obs.descripcion}</p>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
          {obs.asignado_a ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#4FAEB2]/15 text-[9px] font-semibold text-[#3F8E91]">
                {iniciales(obs.asignado_nombre)}
              </span>
              {obs.asignado_nombre ?? "Asignada"}
            </span>
          ) : null}

          {obs.fecha_limite ? (
            <span
              className={`inline-flex items-center gap-1 ${vencida ? "font-semibold text-rose-600" : ""}`}
            >
              <IconClock />
              {fechaCorta(obs.fecha_limite)}
              {vencida ? " · vencida" : ""}
            </span>
          ) : null}

          {obs.comentarios_count > 0 ? (
            <span className="inline-flex items-center gap-1">
              <IconMessage />
              {obs.comentarios_count}
            </span>
          ) : null}

          {obs.archivos.length > 0 ? (
            <span className="inline-flex items-center gap-1">
              <IconImage />
              {obs.archivos.length}
            </span>
          ) : null}

          {marcada ? (
            <span className="text-slate-400">
              {obs.estado === "verificado"
                ? `Verificada por ${obs.verificado_por_nombre ?? "—"}`
                : `Resuelta por ${obs.resuelto_por_nombre ?? "—"}`}
            </span>
          ) : null}
        </div>
      </button>

      {portada?.url ? (
        <button
          type="button"
          onClick={() => onAbrir(obs)}
          className="hidden h-14 w-16 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 sm:block"
          aria-label="Ver capturas"
        >
          {/* Signed URL de Supabase: el optimizador de Next no tiene este host configurado. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={portada.url} alt="" className="h-full w-full object-cover" />
        </button>
      ) : null}
    </li>
  );
}
