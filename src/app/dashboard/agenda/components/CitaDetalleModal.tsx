"use client";

import { useState } from "react";
import { CalendarClock, MapPin, Phone, User, UserPlus, X } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { estadoStyle } from "@/app/dashboard/agenda/calendar-utils";
import { inicialesNombre, nombreCapitular } from "@/lib/format/nombres";
import SpotlightCard from "@/components/reactbits/SpotlightCard";
import type { AgendaCitaEnriquecida, AgendaEstado } from "@/lib/agenda/types";

const TZ = "America/Asuncion";

/** "vie 21/08" — el día, sin la hora. */
function fmtDia(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-PY", { timeZone: TZ, weekday: "long", day: "2-digit", month: "long" });
}

/** "10:00" */
function fmtHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-PY", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
}

/** "30 min" / "1 h 30 min" — se lee más rápido que restar dos horarios. */
function duracion(inicio: string, fin: string): string {
  const ms = Date.parse(fin) - Date.parse(inicio);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

/** Paleta estable por nombre, para que cada persona conserve su color. */
const AVATARES = [
  "bg-[#4FAEB2]/15 text-[#2F6E71]",
  "bg-violet-500/15 text-violet-700",
  "bg-amber-500/20 text-amber-700",
  "bg-emerald-600/15 text-emerald-700",
  "bg-rose-500/15 text-rose-700",
  "bg-sky-600/15 text-sky-700",
];
function avatarClase(nombre: string): string {
  let h = 0;
  for (let i = 0; i < nombre.length; i++) h = (h * 31 + nombre.charCodeAt(i)) >>> 0;
  return AVATARES[h % AVATARES.length];
}

export default function CitaDetalleModal({
  open,
  cita,
  onClose,
  onEditar,
  onReprogramar,
  onChanged,
}: {
  open: boolean;
  cita: AgendaCitaEnriquecida | null;
  onClose: () => void;
  onEditar: (c: AgendaCitaEnriquecida) => void;
  onReprogramar: (c: AgendaCitaEnriquecida) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open || !cita) return null;
  const terminal =
    cita.estado === "completada" ||
    cita.estado === "no_asistio" ||
    cita.estado === "cancelada" ||
    cita.estado === "reprogramada";

  const est = estadoStyle(cita.estado);

  async function setEstado(estado: AgendaEstado) {
    if (!cita) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetchWithSupabaseSession(`/api/agenda/${cita.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setError(json?.error ?? "No se pudo actualizar.");
        setBusy(false);
        return;
      }
      setBusy(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error.");
      setBusy(false);
    }
  }

  async function cancelar() {
    if (!cita) return;
    const motivo = window.prompt("Motivo de cancelación (opcional):") ?? "";
    setBusy(true);
    setError(null);
    try {
      const qs = motivo ? `?motivo=${encodeURIComponent(motivo)}` : "";
      const res = await fetchWithSupabaseSession(`/api/agenda/${cita.id}${qs}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setError(json?.error ?? "No se pudo cancelar.");
        setBusy(false);
        return;
      }
      setBusy(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error.");
      setBusy(false);
    }
  }

  const responsables = cita.responsables?.length
    ? cita.responsables
    : [{ id: cita.responsable_id, nombre: cita.responsable?.nombre ?? null }];

  const cliente = cita.cliente?.nombre ?? cita.contacto_nombre ?? null;
  const dur = duracion(cita.inicio_at, cita.fin_at);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl">
        {/*
          Encabezado: título + estado como chip de color. Antes el estado era
          texto suelto en minúscula, indistinguible del resto de los valores; es
          el dato que se mira primero y ahora se lee como tal.
        */}
        <SpotlightCard spotlightColor="rgba(79, 174, 178, 0.14)">
          <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${est.chip}`}
                >
                  <i aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${est.dot}`} />
                  {est.label}
                </span>
                {cita.tipo ? (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">
                    {cita.tipo}
                  </span>
                ) : null}
              </div>
              <h2 className="mt-1.5 text-lg font-semibold leading-tight tracking-tight text-slate-900">
                {cita.titulo}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              aria-label="Cerrar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </SpotlightCard>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          {/*
            Bloque de fecha y hora. Antes eran dos filas ("Inicio" y "Fin") que
            obligaban a restar mentalmente; ahora es un rango con la duración ya
            calculada, que es el dato que se busca.
          */}
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#4FAEB2]/12 text-[#3F8E91]">
              <CalendarClock className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              {/*
                `first-letter:uppercase` y no `capitalize`: este último pone
                mayúscula en CADA palabra y deja "Viernes 21 De Agosto". Acá sólo
                hay que levantar la primera letra de la frase.
              */}
              <p className="text-[13px] font-semibold text-slate-900 first-letter:uppercase">
                {fmtDia(cita.inicio_at)}
              </p>
              <p className="text-[12px] text-slate-500">
                {fmtHora(cita.inicio_at)} – {fmtHora(cita.fin_at)}
                {dur ? <span className="text-slate-400"> · {dur}</span> : null}
              </p>
            </div>
          </div>

          <Seccion titulo={responsables.length > 1 ? "Responsables" : "Responsable"} icono={User}>
            <ul className="space-y-1.5">
              {responsables.map((r, i) => {
                const nombre = nombreCapitular(r.nombre ?? r.id);
                return (
                  <li key={r.id} className="flex items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${avatarClase(nombre)}`}
                    >
                      {inicialesNombre(r.nombre ?? r.id)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-slate-800">{nombre}</span>
                    {i === 0 && responsables.length > 1 ? (
                      <span className="shrink-0 rounded-md bg-[#4FAEB2]/12 px-1.5 py-0.5 text-[10px] font-semibold text-[#3F8E91]">
                        principal
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Seccion>

          {cita.creado_por ? (
            <Seccion titulo="Cargada por" icono={UserPlus}>
              <p className="text-[13px] text-slate-800">
                {nombreCapitular(cita.creado_por.nombre ?? cita.creado_por.id)}
              </p>
            </Seccion>
          ) : null}

          {cliente || cita.contacto_telefono ? (
            <Seccion titulo="Cliente / contacto" icono={Phone}>
              {cliente ? <p className="text-[13px] text-slate-800">{cliente}</p> : null}
              {cita.contacto_telefono ? (
                <p className="text-[12px] text-slate-500">{cita.contacto_telefono}</p>
              ) : null}
            </Seccion>
          ) : null}

          {cita.ubicacion ? (
            <Seccion titulo="Ubicación / enlace" icono={MapPin}>
              {/^https?:\/\//i.test(cita.ubicacion.trim()) ? (
                <a
                  href={cita.ubicacion.trim()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-[13px] text-[#3F8E91] underline underline-offset-2 hover:text-[#2F6E71]"
                >
                  {cita.ubicacion}
                </a>
              ) : (
                <p className="break-words text-[13px] text-slate-800">{cita.ubicacion}</p>
              )}
            </Seccion>
          ) : null}

          {cita.observaciones ? (
            <Seccion titulo="Observaciones">
              <p className="whitespace-pre-wrap break-words text-[13px] text-slate-700">
                {cita.observaciones}
              </p>
            </Seccion>
          ) : null}

          {cita.cancelada_motivo ? (
            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-700">
                Motivo de cancelación
              </p>
              <p className="mt-0.5 break-words text-[13px] text-rose-900">{cita.cancelada_motivo}</p>
            </div>
          ) : null}

          {error ? (
            <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </div>
          ) : null}
        </div>

        {/*
          Acciones con jerarquía en vez de seis pastillas del mismo peso: la
          acción de avance va llena, el resto en contorno, y "Cancelar" queda
          separada a la izquierda porque es la destructiva.
        */}
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3.5">
          {terminal ? (
            <span className="text-xs text-slate-400">
              Cita en estado terminal ({est.label.toLowerCase()}). No admite más cambios.
            </span>
          ) : (
            <>
              <button
                disabled={busy}
                onClick={cancelar}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
              >
                Cancelar cita
              </button>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <BtnSec disabled={busy} onClick={() => onEditar(cita)}>
                  Editar
                </BtnSec>
                <BtnSec disabled={busy} onClick={() => onReprogramar(cita)}>
                  Reprogramar
                </BtnSec>
                <BtnSec disabled={busy} onClick={() => setEstado("no_asistio")}>
                  No asistió
                </BtnSec>
                {cita.estado === "pendiente" ? (
                  <BtnPri disabled={busy} onClick={() => setEstado("confirmada")}>
                    Confirmar
                  </BtnPri>
                ) : (
                  <BtnPri disabled={busy} onClick={() => setEstado("completada")}>
                    Completar
                  </BtnPri>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Seccion({
  titulo,
  icono: Icono,
  children,
}: {
  titulo: string;
  icono?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4">
      <div className="mb-1.5 flex items-center gap-1.5">
        {Icono ? <Icono className="h-3 w-3 text-slate-400" aria-hidden /> : null}
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">{titulo}</p>
      </div>
      {children}
    </div>
  );
}

function BtnPri({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="rounded-lg bg-[#3F8E91] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#2F6E71] disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function BtnSec({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:border-slate-300 hover:text-slate-800 disabled:opacity-50"
    >
      {children}
    </button>
  );
}
