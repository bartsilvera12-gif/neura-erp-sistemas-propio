"use client";

import { useMemo } from "react";
import SpotlightCard from "@/components/reactbits/SpotlightCard";
import { inicialesNombre, nombreCapitular } from "@/lib/format/nombres";
import { TZ_PY, horaPY } from "@/lib/format/hora-py";

/**
 * Historial del proyecto como línea de tiempo.
 *
 * Antes era una tabla de siete columnas donde convivían dos cosas distintas:
 * los cambios de estado (con entrada, salida y duración) y las reasignaciones
 * de técnico, que no tienen ni salida ni duración y ocupaban esas celdas con
 * guiones. Encima la fecha completa se repetía en cada fila aunque todo hubiera
 * pasado el mismo día, y los nombres se cortaban a mitad ("MARCO ALBERTO …").
 *
 * Un historial se lee como una secuencia, así que va como secuencia: agrupado
 * por día, con la hora al costado y cada tipo de evento contando lo suyo.
 */

type Evento = Record<string, unknown>;

/** Clave YYYY-MM-DD en hora de Paraguay, para agrupar por día real. */
function diaPY(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ_PY,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** "Hoy" / "Ayer" / "viernes 21 de agosto de 2026". */
function etiquetaDia(claveDia: string): string {
  const hoy = diaPY(new Date().toISOString());
  const ayer = diaPY(new Date(Date.now() - 86400000).toISOString());
  if (claveDia === hoy) return "Hoy";
  if (claveDia === ayer) return "Ayer";
  const [y, m, d] = claveDia.split("-").map(Number);
  if (!y) return claveDia;
  // Mediodía y no medianoche: con 00:00 UTC el día se corría al anterior en PY.
  const fecha = new Date(Date.UTC(y, m - 1, d, 12));
  const s = new Intl.DateTimeFormat("es-PY", {
    timeZone: TZ_PY,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(fecha);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function IconFlecha() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconPersona() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" strokeLinecap="round" />
      <circle cx="9" cy="7" r="4" />
      <path d="M19 8v6M22 11h-6" strokeLinecap="round" />
    </svg>
  );
}

export function HistorialLinea({ eventos }: { eventos: Evento[] }) {
  const porDia = useMemo(() => {
    const m = new Map<string, Evento[]>();
    for (const e of eventos) {
      const k = diaPY(String(e.entered_at ?? ""));
      const arr = m.get(k) ?? [];
      arr.push(e);
      m.set(k, arr);
    }
    return [...m.entries()];
  }, [eventos]);

  if (eventos.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
        <p className="text-sm font-medium text-slate-700">Sin historial todavía</p>
        <p className="mt-1 text-xs text-slate-500">
          Acá van a aparecer los cambios de estado y las reasignaciones del proyecto.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {porDia.map(([dia, delDia]) => (
        <section key={dia}>
          <div className="mb-2.5 flex items-center gap-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
              {etiquetaDia(dia)}
            </h3>
            <span className="h-px flex-1 bg-slate-200" />
            <span className="text-[11px] text-slate-400">
              {delDia.length} {delDia.length === 1 ? "movimiento" : "movimientos"}
            </span>
          </div>

          <ol className="space-y-2">
            {delDia.map((h) => {
              const usr = nombreCapitular((h.usuario_cambio_label as string | undefined) ?? "");
              const hora = horaPY(String(h.entered_at ?? ""));
              const esReasignacion = h.evento_tipo === "reasignacion_tecnico";
              // `formatDurationHuman` devuelve "—" cuando todavía no hay salida;
              // como string es truthy y se colaba en el badge como "— en este
              // estado". Se normaliza a vacío.
              const durCruda = String(h.duration_label ?? "").trim();
              const duracion = durCruda && durCruda !== "—" ? durCruda : "";

              return (
                <li key={String(h.id)}>
                  <SpotlightCard
                    spotlightColor={
                      esReasignacion ? "rgba(245, 158, 11, 0.10)" : "rgba(79, 174, 178, 0.10)"
                    }
                    className={`rounded-xl border bg-white p-3 ${
                      esReasignacion ? "border-amber-200" : "border-slate-200"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden="true"
                        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                          esReasignacion
                            ? "bg-amber-100 text-amber-700"
                            : "bg-[#4FAEB2]/12 text-[#2F6E71]"
                        }`}
                      >
                        {esReasignacion ? <IconPersona /> : <IconFlecha />}
                      </span>

                      <div className="min-w-0 flex-1">
                        {esReasignacion ? (
                          <>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-amber-700">
                              Reasignación de técnico
                            </p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[13px]">
                              <span className="text-slate-500">
                                {nombreCapitular(
                                  (h.reasignacion_de_label as string | undefined) ?? "Sin asignar"
                                )}
                              </span>
                              <span aria-hidden="true" className="text-slate-300">→</span>
                              <span className="font-semibold text-slate-900">
                                {nombreCapitular(
                                  (h.reasignacion_a_label as string | undefined) ?? "Sin asignar"
                                )}
                              </span>
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="flex flex-wrap items-center gap-1.5 text-[13px]">
                              <span className="text-slate-500">
                                {(h.estado_anterior_nombre as string | undefined) ?? "Alta del proyecto"}
                              </span>
                              <span aria-hidden="true" className="text-slate-300">→</span>
                              <span className="font-semibold text-slate-900">
                                {(h.estado_nuevo_nombre as string | undefined) ??
                                  String(h.estado_nuevo_id ?? "—")}
                              </span>
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                              {duracion ? (
                                <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">
                                  {duracion} en este estado
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-md bg-[#4FAEB2]/10 px-1.5 py-0.5 font-medium text-[#2F6E71]">
                                  Estado actual
                                </span>
                              )}
                              {h.tipo_sla_label ? <span>{String(h.tipo_sla_label)}</span> : null}
                            </div>
                          </>
                        )}
                      </div>

                      {/*
                        Quién y cuándo, visibles y no escondidos detrás de un
                        tooltip: es el registro que se usa para seguimiento.
                      */}
                      <div className="flex shrink-0 flex-col items-end gap-1 pl-2">
                        <span className="text-[12px] font-semibold tabular-nums text-slate-700">{hora}</span>
                        {usr !== "—" ? (
                          <span className="flex items-center gap-1.5">
                            <span
                              aria-hidden="true"
                              className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[8px] font-bold text-slate-500"
                            >
                              {inicialesNombre(usr)}
                            </span>
                            <span className="max-w-[140px] truncate text-[11px] text-slate-500" title={usr}>
                              {usr}
                            </span>
                          </span>
                        ) : (
                          <span className="text-[11px] italic text-slate-300">sin registrar</span>
                        )}
                      </div>
                    </div>
                  </SpotlightCard>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
