"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ShieldCheck, Settings2, X } from "lucide-react";
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
  data?: { es_admin: boolean; guardias: Guardia[] };
  error?: string;
};

const ROLES = [
  { campo: "pm_id", etiqueta: "PM de guardia" },
  { campo: "soporte_principal_id", etiqueta: "Soporte principal" },
  { campo: "soporte_suplente_id", etiqueta: "Soporte suplente" },
] as const;

function Persona({ etiqueta, nombre }: { etiqueta: string; nombre: string }) {
  const iniciales = nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
          nombre ? "bg-[#4FAEB2]/12 text-[#2F6E71]" : "bg-slate-100 text-slate-300"
        }`}
        aria-hidden
      >
        {iniciales || "—"}
      </span>
      <span className="min-w-0">
        <span className="block text-[10px] font-bold uppercase tracking-wide text-[#4FAEB2]">
          {etiqueta}
        </span>
        <span
          className={`block truncate text-sm ${
            nombre ? "font-semibold text-slate-900" : "italic text-slate-400"
          }`}
        >
          {nombre || "Sin asignar"}
        </span>
      </span>
    </div>
  );
}

function Semana({ g, lunes, titulo }: { g: Guardia | undefined; lunes: string; titulo: string }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700">{titulo}</h3>
        <span className="text-[11px] text-slate-400">{rangoLegible(lunes)}</span>
      </div>
      {g ? (
        <div className="space-y-1.5">
          {ROLES.map((r) => (
            <Persona key={r.campo} etiqueta={r.etiqueta} nombre={g.nombres?.[r.campo] ?? ""} />
          ))}
          {g.notas ? (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900">
              {g.notas}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-[12px] text-slate-500">
          Todavía no hay guardia asignada para esta semana.
        </p>
      )}
    </section>
  );
}

/**
 * Quién está de guardia, a un clic desde cualquier pantalla.
 *
 * Va en el header y no en un módulo porque el momento en que hace falta es
 * justamente cuando uno no está buscándolo: cae algo urgente y hay que saber a
 * quién escribir. Muestra esta semana y la que viene —la segunda importa para
 * coordinar de antemano— y no pide permisos para leer.
 */
export default function GuardiasBoton() {
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [esAdmin, setEsAdmin] = useState(false);
  const [guardias, setGuardias] = useState<Guardia[]>([]);

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
            <div className="flex items-center gap-2 border-b border-[#4FAEB2]/15 bg-gradient-to-r from-[#4FAEB2]/12 via-[#4FAEB2]/5 to-transparent px-4 py-3">
              <ShieldCheck className="h-4 w-4 text-[#2F6E71]" />
              <h2 className="flex-1 text-sm font-bold text-[#2F6E71]">Guardias</h2>
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
                className="grid h-7 w-7 place-items-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[70vh] space-y-5 overflow-y-auto px-4 py-4">
              {cargando ? (
                <p className="py-6 text-center text-sm text-slate-400">Cargando…</p>
              ) : error ? (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
                  {error}
                </p>
              ) : (
                <>
                  <Semana g={deLaSemana(estaSemana)} lunes={estaSemana} titulo="Esta semana" />
                  <Semana g={deLaSemana(proxima)} lunes={proxima} titulo="La semana que viene" />
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
