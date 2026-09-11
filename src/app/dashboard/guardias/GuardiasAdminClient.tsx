"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarRange, Check, ShieldCheck } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { FancySelect } from "@/app/dashboard/proyectos/components/FancySelect";
import { lunesDeEstaSemana, rangoLegible, sumarSemanas } from "@/lib/guardias/semana";

type Guardia = {
  semana_inicio: string;
  pm_id: string | null;
  soporte_principal_id: string | null;
  soporte_suplente_id: string | null;
  notas: string | null;
  nombres: Record<string, string>;
};

type Usuario = { id: string; nombre: string | null; email: string | null };

/** Cuántas semanas se muestran: la actual y las siguientes. */
const SEMANAS = 8;

const ROLES = [
  { campo: "pm_id", etiqueta: "PM de guardia" },
  { campo: "soporte_principal_id", etiqueta: "Soporte principal" },
  { campo: "soporte_suplente_id", etiqueta: "Soporte suplente" },
] as const;

type CampoRol = (typeof ROLES)[number]["campo"];

type Borrador = {
  pm_id: string;
  soporte_principal_id: string;
  soporte_suplente_id: string;
  notas: string;
};

const VACIO: Borrador = { pm_id: "", soporte_principal_id: "", soporte_suplente_id: "", notas: "" };

function aBorrador(g: Guardia | undefined): Borrador {
  if (!g) return VACIO;
  return {
    pm_id: g.pm_id ?? "",
    soporte_principal_id: g.soporte_principal_id ?? "",
    soporte_suplente_id: g.soporte_suplente_id ?? "",
    notas: g.notas ?? "",
  };
}

function igual(a: Borrador, b: Borrador): boolean {
  return (
    a.pm_id === b.pm_id &&
    a.soporte_principal_id === b.soporte_principal_id &&
    a.soporte_suplente_id === b.soporte_suplente_id &&
    a.notas.trim() === b.notas.trim()
  );
}

/**
 * Asignación de guardias, semana por semana.
 *
 * Se muestran la semana en curso y las siete siguientes: cargar guardias con
 * anticipación es justamente el punto —si sólo se pudiera la de hoy, nadie
 * sabría de antemano cuándo le toca— y ocho semanas es un bimestre, que es lo
 * que la gente planifica sin que la lista se vuelva inmanejable.
 *
 * Cada semana se guarda por su cuenta. Un botón único "guardar todo" obligaría a
 * revisar ocho semanas para corregir una.
 */
export default function GuardiasAdminClient() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [guardias, setGuardias] = useState<Guardia[]>([]);
  const [borradores, setBorradores] = useState<Record<string, Borrador>>({});
  const [guardando, setGuardando] = useState<string | null>(null);
  const [guardado, setGuardado] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const desde = lunesDeEstaSemana();
  const semanas = useMemo(
    () => Array.from({ length: SEMANAS }, (_, i) => sumarSemanas(desde, i)),
    [desde]
  );

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const [rg, ru] = await Promise.all([
        fetchWithSupabaseSession(`/api/guardias?desde=${desde}&semanas=${SEMANAS}`, {
          cache: "no-store",
        }),
        fetchWithSupabaseSession("/api/usuarios/empresa-activos", { cache: "no-store" }),
      ]);
      const jg = (await rg.json().catch(() => null)) as
        | { success: boolean; data?: { guardias: Guardia[] }; error?: string }
        | null;
      const ju = (await ru.json().catch(() => null)) as
        | { data?: Usuario[]; usuarios?: Usuario[] }
        | Usuario[]
        | null;

      if (!rg.ok || !jg?.success || !jg.data) {
        setError(jg?.error ?? "No se pudieron cargar las guardias");
        return;
      }
      setGuardias(jg.data.guardias);
      const mapa: Record<string, Borrador> = {};
      for (const s of semanas) {
        mapa[s] = aBorrador(jg.data.guardias.find((g) => g.semana_inicio === s));
      }
      setBorradores(mapa);

      const lista = Array.isArray(ju) ? ju : (ju?.data ?? ju?.usuarios ?? []);
      setUsuarios(lista as Usuario[]);
    } catch {
      setError("No se pudieron cargar las guardias");
    } finally {
      setCargando(false);
    }
  }, [desde, semanas]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const opciones = useMemo(
    () => [
      { value: "", label: "Sin asignar" },
      ...usuarios.map((u) => ({
        value: u.id,
        label: (u.nombre?.trim() || u.email?.trim() || u.id) as string,
      })),
    ],
    [usuarios]
  );

  const editar = (semana: string, campo: keyof Borrador, valor: string) => {
    setBorradores((prev) => ({ ...prev, [semana]: { ...(prev[semana] ?? VACIO), [campo]: valor } }));
    setGuardado(null);
  };

  async function guardar(semana: string) {
    const b = borradores[semana] ?? VACIO;
    setGuardando(semana);
    setError(null);
    try {
      const res = await fetchWithSupabaseSession("/api/guardias", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          semana_inicio: semana,
          pm_id: b.pm_id || null,
          soporte_principal_id: b.soporte_principal_id || null,
          soporte_suplente_id: b.soporte_suplente_id || null,
          notas: b.notas.trim() || null,
        }),
      });
      const j = (await res.json().catch(() => null)) as
        | { success: boolean; data?: Guardia; error?: string }
        | null;
      if (!res.ok || !j?.success || !j.data) {
        setError(j?.error ?? "No se pudo guardar");
        return;
      }
      const actualizada = j.data;
      setGuardias((prev) => [
        ...prev.filter((g) => g.semana_inicio !== semana),
        actualizada,
      ]);
      setGuardado(semana);
      window.setTimeout(() => setGuardado((s) => (s === semana ? null : s)), 2000);
    } catch {
      setError("No se pudo guardar");
    } finally {
      setGuardando(null);
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-4 pb-12 pt-6 md:px-6">
      <header>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[#4FAEB2]" />
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">
            Administración
          </p>
        </div>
        <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">
          Guardias de la semana
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Quién queda de turno cada semana. Lo que se cargue acá lo ve todo el equipo desde el botón
          Guardias del encabezado, sin necesidad de este módulo.
        </p>
      </header>

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      {cargando ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
          Cargando…
        </p>
      ) : (
        <div className="space-y-3">
          {semanas.map((semana, i) => {
            const b = borradores[semana] ?? VACIO;
            const original = aBorrador(guardias.find((g) => g.semana_inicio === semana));
            const sucio = !igual(b, original);
            const esActual = i === 0;
            return (
              <section
                key={semana}
                className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${
                  esActual ? "border-[#4FAEB2]/45 ring-1 ring-[#4FAEB2]/20" : "border-slate-200"
                }`}
              >
                <div
                  className={`flex flex-wrap items-center gap-2 border-b px-4 py-2.5 ${
                    esActual
                      ? "border-[#4FAEB2]/20 bg-gradient-to-r from-[#4FAEB2]/12 via-[#4FAEB2]/5 to-transparent"
                      : "border-slate-100 bg-slate-50/70"
                  }`}
                >
                  <CalendarRange
                    className={`h-4 w-4 ${esActual ? "text-[#2F6E71]" : "text-slate-400"}`}
                  />
                  <h2
                    className={`text-sm font-bold ${esActual ? "text-[#2F6E71]" : "text-slate-700"}`}
                  >
                    {rangoLegible(semana)}
                  </h2>
                  {esActual ? (
                    <span className="rounded-full bg-[#4FAEB2] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                      En curso
                    </span>
                  ) : null}
                  <div className="ml-auto flex items-center gap-2">
                    {guardado === semana ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
                        <Check className="h-3.5 w-3.5" /> Guardado
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void guardar(semana)}
                      disabled={!sucio || guardando === semana}
                      className="rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-[#3F8E91] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
                    >
                      {guardando === semana ? "Guardando…" : "Guardar"}
                    </button>
                  </div>
                </div>

                <div className="grid gap-3 px-4 py-3 sm:grid-cols-3">
                  {ROLES.map((r) => (
                    <label
                      key={r.campo}
                      className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#2F6E71]"
                    >
                      {r.etiqueta}
                      <FancySelect
                        ariaLabel={`${r.etiqueta} · ${rangoLegible(semana)}`}
                        value={b[r.campo as CampoRol]}
                        onChange={(v) => editar(semana, r.campo as keyof Borrador, v)}
                        placeholder="Sin asignar"
                        options={opciones}
                      />
                    </label>
                  ))}
                </div>

                <div className="px-4 pb-3">
                  <input
                    value={b.notas}
                    onChange={(e) => editar(semana, "notas", e.target.value)}
                    placeholder="Nota para el equipo (opcional) — ej.: feriado el viernes"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 transition-colors focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20"
                  />
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
