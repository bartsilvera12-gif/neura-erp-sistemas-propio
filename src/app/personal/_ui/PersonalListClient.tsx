"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Users, Search, Clock, Trophy, AlertTriangle } from "lucide-react";
import { apiPersonal } from "./api";
import type { FuncionarioResumen } from "@/lib/personal/types";

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function Inicial({ nombre }: { nombre: string }) {
  const ini = nombre.trim().split(/\s+/).slice(0, 2).map((p) => p[0] ?? "").join("").toUpperCase() || "?";
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#4FAEB2] to-[#2F8E92] text-sm font-bold text-white">
      {ini}
    </span>
  );
}

export default function PersonalListClient() {
  const [lista, setLista] = useState<FuncionarioResumen[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    apiPersonal<{ funcionarios: FuncionarioResumen[] }>("/api/personal")
      .then((d) => setLista(d.funcionarios))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar"));
  }, []);

  const filtrada = useMemo(() => {
    if (!lista) return [];
    const t = normalizar(q.trim());
    if (!t) return lista;
    const términos = t.split(/\s+/);
    return lista.filter((f) => {
      const campo = normalizar([f.nombre, f.cargo, f.area, f.codigo_empleado].filter(Boolean).join(" "));
      return términos.every((term) => campo.includes(term));
    });
  }, [lista, q]);

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <header className="mb-5 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#4FAEB2]/10 text-[#2F8E92]">
          <Users className="h-6 w-6" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Gestión de Personal</h1>
          <p className="text-sm text-slate-500">Hoja de vida, asistencia e incidencias del equipo.</p>
        </div>
      </header>

      <div className="relative mb-5 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre, cargo, área o código…"
          className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-800 shadow-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
        />
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : lista == null ? (
        <div className="py-20 text-center text-sm text-slate-400">Cargando…</div>
      ) : filtrada.length === 0 ? (
        <div className="py-20 text-center text-sm text-slate-400">{q ? "Sin resultados." : "No hay funcionarios cargados."}</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtrada.map((f) => (
            <Link
              key={f.id}
              href={`/personal/${f.id}`}
              className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-[#4FAEB2]/50 hover:shadow-md"
            >
              <div className="flex items-start gap-3">
                <Inicial nombre={f.nombre} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-900 group-hover:text-[#2F8E92]">{f.nombre}</p>
                  <p className="truncate text-[13px] text-slate-500">
                    {[f.cargo, f.area].filter(Boolean).join(" · ") || "Sin cargo"}
                  </p>
                  <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-slate-400">
                    {f.codigo_empleado ? <span>Código {f.codigo_empleado}</span> : null}
                    <span
                      className={`rounded-full px-1.5 py-px font-semibold ${
                        (f.estado ?? "").toLowerCase() === "activo"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {f.estado ?? "—"}
                    </span>
                  </div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-center">
                <div className="flex flex-col items-center gap-0.5">
                  <Clock className="h-4 w-4 text-amber-500" aria-hidden />
                  <span className="text-sm font-bold text-slate-800">{f.kpis.llegadas_tardias}</span>
                  <span className="text-[10px] text-slate-400">Tardías</span>
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <AlertTriangle className="h-4 w-4 text-rose-500" aria-hidden />
                  <span className="text-sm font-bold text-slate-800">{f.kpis.incidencias}</span>
                  <span className="text-[10px] text-slate-400">Incidencias</span>
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <Trophy className="h-4 w-4 text-emerald-500" aria-hidden />
                  <span className="text-sm font-bold text-slate-800">{f.kpis.reconocimientos}</span>
                  <span className="text-[10px] text-slate-400">Reconoc.</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
