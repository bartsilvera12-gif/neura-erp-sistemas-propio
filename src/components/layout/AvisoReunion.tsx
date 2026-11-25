"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, Clock, Users, X } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

/**
 * Aviso de la reunión en curso o la próxima de hoy, en el centro de la barra de arriba.
 * Lila si es más tarde, ámbar a 30 minutos o menos, verde mientras está en curso.
 * La X la oculta sólo para ESA reunión (en este navegador); la siguiente vuelve a avisar.
 */

type Reunion = {
  cita_id: string;
  titulo: string;
  inicio_at: string;
  fin_at: string | null;
  ubicacion: string | null;
  en_curso: boolean;
};

const CLAVE_OCULTAS = "neura_erp_reuniones_ocultas";
const CADA_MS = 60_000;

function leerOcultas(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(CLAVE_OCULTAS) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-PY", {
    timeZone: "Etc/GMT+3",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function AvisoReunion() {
  const [reunion, setReunion] = useState<Reunion | null>(null);
  const [ocultas, setOcultas] = useState<string[]>([]);
  const [ahora, setAhora] = useState(() => Date.now());

  const cargar = useCallback(async () => {
    try {
      const r = await fetchWithSupabaseSession("/api/agenda/proxima", { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as { data?: { reunion?: Reunion | null } } | null;
      setReunion(j?.data?.reunion ?? null);
    } catch {
      /* sin aviso */
    }
  }, []);

  useEffect(() => {
    setOcultas(leerOcultas());
    void cargar();
    const id = window.setInterval(() => {
      setAhora(Date.now());
      void cargar();
    }, CADA_MS);
    return () => window.clearInterval(id);
  }, [cargar]);

  if (!reunion || ocultas.includes(reunion.cita_id)) return null;

  const faltan = Math.round((Date.parse(reunion.inicio_at) - ahora) / 60_000);
  const enCurso = reunion.en_curso || faltan <= 0;
  const cerca = !enCurso && faltan <= 30;

  const tono = enCurso
    ? { caja: "bg-emerald-50 text-emerald-900", icono: "bg-emerald-600 text-white", boton: "bg-emerald-600 text-white hover:bg-emerald-700" }
    : cerca
      ? { caja: "bg-amber-50 text-amber-900", icono: "bg-amber-300 text-amber-900", boton: "bg-white text-amber-800 hover:bg-amber-100" }
      : { caja: "bg-violet-50 text-violet-900", icono: "bg-violet-200 text-violet-800", boton: "bg-white text-violet-700 hover:bg-violet-100" };
  const Icono = enCurso ? Users : cerca ? Clock : CalendarClock;
  const cuando = enCurso ? "Ahora" : cerca ? `En ${Math.max(1, faltan)} min` : hora(reunion.inicio_at);

  const ocultar = () => {
    const sig = [...ocultas.filter((x) => x !== reunion.cita_id), reunion.cita_id].slice(-30);
    setOcultas(sig);
    try {
      window.localStorage.setItem(CLAVE_OCULTAS, JSON.stringify(sig));
    } catch {
      /* se oculta igual hasta recargar */
    }
  };

  return (
    <div className="flex min-w-0 flex-1 justify-center px-2">
      <div
        className={`flex min-w-0 max-w-full items-center gap-2 rounded-full py-1 pl-1 pr-1.5 text-[13px] ${tono.caja}`}
        title={`${reunion.titulo} · ${hora(reunion.inicio_at)}${reunion.ubicacion ? ` · ${reunion.ubicacion}` : ""}`}
      >
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${tono.icono}`}>
          <Icono className="h-4 w-4" />
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          {enCurso ? <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500" /> : null}
          <span className="shrink-0 font-semibold">{cuando}</span>
          <span className="hidden min-w-0 truncate md:inline">
            · {reunion.titulo}
            {reunion.ubicacion && cerca ? ` · ${reunion.ubicacion}` : ""}
          </span>
        </span>
        <Link
          href={`/dashboard/agenda?cita=${reunion.cita_id}`}
          className={`hidden shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold shadow-sm transition-colors sm:inline ${tono.boton}`}
        >
          {enCurso ? "Abrir" : "Ver en agenda"}
        </Link>
        <button
          type="button"
          onClick={ocultar}
          aria-label="Ocultar este aviso"
          title="Ocultar este aviso"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full opacity-60 transition-opacity hover:bg-black/5 hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
