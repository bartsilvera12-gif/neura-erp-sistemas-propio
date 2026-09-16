"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowUpDown, Clock, Loader2, Settings2, ShieldCheck, Users, X } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { lunesDeEstaSemana, rangoLegible, sumarSemanas } from "@/lib/guardias/semana";

type Guardia = {
  semana_inicio: string;
  pm_id: string | null;
  soporte_principal_id: string | null;
  soporte_suplente_id: string | null;
  notas: string | null;
  nombres: Record<string, string>;
};

type Resp = {
  success: boolean;
  data?: { es_admin: boolean; usuario_id?: string; guardias: Guardia[] };
  error?: string;
};

/**
 * Iniciales para el avatar. Nombre y primer apellido: con cuatro palabras el
 * apellido es la tercera (dos nombres + dos apellidos), que es como está
 * cargada la mayoría de la gente.
 */
function iniciales(nombre: string): string {
  const w = nombre.trim().split(/\s+/).filter(Boolean);
  if (w.length === 0) return "";
  if (w.length >= 4) return (w[0][0] + w[2][0]).toUpperCase();
  return w.slice(0, 2).map((x) => x[0]).join("").toUpperCase();
}

type Tono = {
  /** Caja de la sección entera. */
  caja: string;
  rotulo: string;
  insignia: string;
  punto: string;
  avatar: string;
  etiqueta: string;
};

const TONO_ACTIVA: Tono = {
  caja: "border-[#4FAEB2]/30 bg-[#4FAEB2]/[0.07]",
  rotulo: "text-[#2F6E71]",
  insignia: "border-[#4FAEB2]/30 bg-white text-[#2F6E71]",
  punto: "bg-[#4FAEB2]",
  avatar: "bg-[#4FAEB2]/15 text-[#2F6E71]",
  etiqueta: "text-[#4FAEB2]",
};

const TONO_PROXIMA: Tono = {
  caja: "border-slate-200 bg-slate-50/80",
  rotulo: "text-slate-600",
  insignia: "border-slate-200 bg-white text-slate-500",
  punto: "bg-slate-300",
  avatar: "bg-slate-100 text-slate-400",
  etiqueta: "text-slate-400",
};

function Persona({
  etiqueta,
  nombre,
  tono,
  destacado,
}: {
  etiqueta: string;
  nombre: string;
  tono: Tono;
  /** El PM va con el nombre más grande: es el primero a quien se escribe. */
  destacado?: boolean;
}) {
  const ini = iniciales(nombre);
  return (
    <div className="flex items-center gap-3">
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
          nombre ? tono.avatar : "bg-slate-100 text-slate-300"
        }`}
        aria-hidden
      >
        {ini || "—"}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block text-[10px] font-bold uppercase tracking-wide ${
            destacado ? tono.etiqueta : "text-slate-400"
          }`}
        >
          {etiqueta}
        </span>
        <span
          className={`block truncate ${destacado ? "text-[15px]" : "text-sm"} ${
            nombre ? "font-semibold text-slate-900" : "italic font-normal text-slate-400"
          }`}
        >
          {nombre || "Sin asignar"}
        </span>
      </span>
    </div>
  );
}

function Semana({
  g,
  lunes,
  titulo,
  insignia,
  activa,
  puedeIntercambiar = false,
  onIntercambiar,
}: {
  g: Guardia | undefined;
  lunes: string;
  titulo: string;
  insignia: string;
  activa: boolean;
  /** Admin o PM de esa guardia, y con principal y suplente cargados. */
  puedeIntercambiar?: boolean;
  onIntercambiar?: () => Promise<void>;
}) {
  const [intercambiando, setIntercambiando] = useState(false);
  const tono = activa ? TONO_ACTIVA : TONO_PROXIMA;
  const nombre = (campo: string) => g?.nombres?.[campo] ?? "";

  return (
    <section className={`rounded-2xl border p-3 ${tono.caja}`}>
      <div className="mb-2.5 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className={`text-[13px] font-extrabold uppercase tracking-wide ${tono.rotulo}`}>
            {titulo}
          </h3>
          <p className="text-[11px] text-slate-500">{rangoLegible(lunes)}</p>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${tono.insignia}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${tono.punto}`} aria-hidden />
          {insignia}
        </span>
      </div>

      {g ? (
        <div className="space-y-2">
          {/* El PM en su propia tarjeta: es un rol distinto, no un tercer
              soporte, y agruparlos hacía que se leyeran como lo mismo. */}
          <div className="rounded-xl border border-slate-200/90 bg-white px-3 py-2.5 shadow-sm">
            <Persona etiqueta="PM de guardia" nombre={nombre("pm_id")} tono={tono} destacado />
          </div>

          <div className="rounded-xl border border-slate-200/90 bg-white px-3 py-2.5 shadow-sm">
            <div className="mb-2 flex items-center gap-1.5 border-b border-slate-100 pb-2">
              <Users className="h-3.5 w-3.5 text-slate-400" aria-hidden />
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Soporte técnico
              </span>
              {puedeIntercambiar && onIntercambiar ? (
                <button
                  type="button"
                  disabled={intercambiando}
                  onClick={async () => {
                    setIntercambiando(true);
                    try {
                      await onIntercambiar();
                    } finally {
                      setIntercambiando(false);
                    }
                  }}
                  title="Activar al suplente: pasa a principal y el principal queda de suplente"
                  className="ml-auto inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10.5px] font-bold text-slate-600 transition hover:border-[#4FAEB2]/60 hover:text-[#2F6E71] disabled:opacity-60"
                >
                  {intercambiando ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <ArrowUpDown className="h-3 w-3" aria-hidden />}
                  Intercambiar
                </button>
              ) : null}
            </div>
            <div className="space-y-2.5">
              <Persona etiqueta="Principal" nombre={nombre("soporte_principal_id")} tono={tono} />
              <Persona etiqueta="Suplente" nombre={nombre("soporte_suplente_id")} tono={tono} />
            </div>
          </div>

          {g.notas ? (
            <p className="flex items-start gap-2 px-1 pt-0.5 text-[11px] leading-relaxed text-slate-500">
              <Clock className="mt-px h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
              <span className="min-w-0">{g.notas}</span>
            </p>
          ) : null}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white/60 px-3 py-4 text-center text-[12px] text-slate-500">
          Todavía no hay guardia asignada para esta semana.
        </p>
      )}
    </section>
  );
}

export default function GuardiasBoton() {
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [esAdmin, setEsAdmin] = useState(false);
  const [guardias, setGuardias] = useState<Guardia[]>([]);
  const [usuarioId, setUsuarioId] = useState<string | null>(null);

  const estaSemana = lunesDeEstaSemana();
  const proxima = sumarSemanas(estaSemana, 1);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await fetchWithSupabaseSession("/api/guardias?semanas=2", { cache: "no-store" });
      const j = (await res.json().catch(() => null)) as Resp | null;
      if (res.ok && j?.success && j.data) {
        setGuardias(j.data.guardias);
        setEsAdmin(j.data.es_admin);
        setUsuarioId(j.data.usuario_id ?? null);
      } else {
        setError(j?.error ?? "No se pudieron cargar las guardias");
      }
    } catch {
      setError("No se pudieron cargar las guardias");
    } finally {
      setCargando(false);
    }
  }, []);

  // Se pide al abrir y no al montar: es una pantalla que se consulta de vez en
  // cuando, y el header vive en todas las páginas del ERP.
  useEffect(() => {
    if (abierto) void cargar();
  }, [abierto, cargar]);

  useEffect(() => {
    if (!abierto) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [abierto]);

  const deLaSemana = (lunes: string) => guardias.find((g) => g.semana_inicio === lunes);

  // Activar al suplente: admin o PM de esa guardia, con principal y suplente cargados.
  const puedeIntercambiar = (g: Guardia | undefined) =>
    Boolean(
      g?.soporte_principal_id &&
        g.soporte_suplente_id &&
        (esAdmin || (usuarioId && g.pm_id === usuarioId))
    );

  const intercambiar = async (lunes: string) => {
    const g = deLaSemana(lunes);
    if (!g) return;
    const motivo = window.prompt(
      `¿Activar a ${g.nombres.soporte_suplente_id || "el suplente"} como principal?
` +
        `${g.nombres.soporte_principal_id || "El principal"} queda de suplente. Motivo (opcional):`,
      ""
    );
    if (motivo === null) return;
    try {
      const res = await fetchWithSupabaseSession("/api/guardias/intercambiar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ semana_inicio: lunes, motivo }),
      });
      const j = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
      if (!res.ok || !j?.success) {
        // Un error acá no tiene que tapar las semanas: se avisa y listo.
        window.alert(j?.error ?? "No se pudo intercambiar");
        return;
      }
      // Se actualiza en el lugar: no hace falta volver a pedir las semanas.
      setGuardias((lista) =>
        lista.map((x) =>
          x.semana_inicio !== lunes
            ? x
            : {
                ...x,
                soporte_principal_id: x.soporte_suplente_id,
                soporte_suplente_id: x.soporte_principal_id,
                nombres: {
                  ...x.nombres,
                  soporte_principal_id: x.nombres.soporte_suplente_id ?? "",
                  soporte_suplente_id: x.nombres.soporte_principal_id ?? "",
                },
              }
        )
      );
    } catch {
      window.alert("No se pudo intercambiar");
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        title="Guardias de la semana"
        aria-label="Guardias de la semana"
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-[#475569] transition-colors hover:bg-slate-50 hover:text-[#0EA5E9]"
      >
        <ShieldCheck className="h-5 w-5 shrink-0" />
        <span className="hidden lg:inline">Guardias</span>
      </button>

      {/*
        El modal cuelga del `body` y no del header.

        El `<header>` tiene `backdrop-blur-sm`, y un elemento con backdrop-filter
        pasa a ser el marco de referencia de cualquier `position: fixed` que
        tenga adentro. Con el modal ahí, `inset-0` no era la ventana sino la
        franja de 64 px del encabezado: de ahí el recuadro oscuro arriba.
      */}
      {abierto && typeof document !== "undefined"
        ? createPortal(
        <div
          className="fixed inset-0 z-[130] flex items-start justify-center bg-slate-900/40 p-4 pt-20 backdrop-blur-[2px]"
          role="presentation"
          onClick={() => setAbierto(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Guardias de la semana"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          >
            <div className="flex items-center gap-2.5 border-b border-[#4FAEB2]/15 bg-gradient-to-r from-[#4FAEB2]/14 via-[#4FAEB2]/6 to-transparent px-4 py-3.5">
              <ShieldCheck className="h-[18px] w-[18px] text-[#2F6E71]" />
              <h2 className="flex-1 text-base font-extrabold tracking-tight text-[#2F6E71]">
                Guardias
              </h2>
              {esAdmin ? (
                <Link
                  href="/dashboard/guardias"
                  onClick={() => setAbierto(false)}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-[#3F8E91] no-underline transition-colors hover:bg-[#4FAEB2]/10"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  Asignar
                </Link>
              ) : null}
              <button
                type="button"
                onClick={() => setAbierto(false)}
                aria-label="Cerrar"
                className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[70vh] space-y-3 overflow-y-auto bg-slate-50/40 px-3.5 py-3.5">
              {cargando ? (
                <p className="py-6 text-center text-sm text-slate-400">Cargando…</p>
              ) : error ? (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
                  {error}
                </p>
              ) : (
                <>
                  <Semana
                    g={deLaSemana(estaSemana)}
                    lunes={estaSemana}
                    titulo="Esta semana"
                    insignia="Guardia activa"
                    activa
                    puedeIntercambiar={puedeIntercambiar(deLaSemana(estaSemana))}
                    onIntercambiar={() => intercambiar(estaSemana)}
                  />
                  <Semana
                    g={deLaSemana(proxima)}
                    lunes={proxima}
                    titulo="Próxima semana"
                    insignia="Próxima guardia"
                    activa={false}
                    puedeIntercambiar={puedeIntercambiar(deLaSemana(proxima))}
                    onIntercambiar={() => intercambiar(proxima)}
                  />
                </>
              )}
            </div>
          </div>
        </div>,
            document.body
          )
        : null}
    </>
  );
}
