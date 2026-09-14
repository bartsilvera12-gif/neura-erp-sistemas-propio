"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FancySelect } from "@/app/dashboard/proyectos/components/FancySelect";
import { apiSoporte } from "./_ui/api";
import { Aviso, Cargando, Encabezado, Pagina, Tarjeta, Vacio, claseBoton } from "./_ui/ui";

type Dashboard = {
  dias: number;
  kpis: Record<string, number>;
  variacion: Record<string, number | null>;
  por_estado: { codigo: string; nombre: string; color: string; cantidad: number }[];
  por_tipo: { nombre: string; cantidad: number }[];
};

const KPIS: { clave: string; etiqueta: string; malo?: boolean; destacado?: boolean }[] = [
  { clave: "total", etiqueta: "Total de tickets" },
  { clave: "abiertos", etiqueta: "Abiertos" },
  { clave: "en_desarrollo", etiqueta: "En desarrollo" },
  { clave: "en_qa", etiqueta: "En prueba de QA" },
  { clave: "con_observaciones", etiqueta: "Con observaciones", malo: true },
  { clave: "resueltos", etiqueta: "Resueltos (sin cerrar)" },
  { clave: "cerrados", etiqueta: "Cerrados" },
  { clave: "sla_vencidos", etiqueta: "SLA vencidos", malo: true, destacado: true },
];

/** Paleta del gráfico de tipos: turquesa de Zentra primero, después tonos que se distinguen. */
const PALETA_TIPOS = ["#4FAEB2", "#2F6E71", "#8b5cf6", "#f59e0b", "#0ea5e9", "#94a3b8", "#ef4444"];

const PERIODOS = [
  { value: "7", label: "Últimos 7 días" },
  { value: "30", label: "Últimos 30 días" },
  { value: "90", label: "Últimos 90 días" },
  { value: "0", label: "Todo el historial" },
];

function Variacion({ valor, malo }: { valor: number | null | undefined; malo?: boolean }) {
  if (valor == null) return <span className="text-[11px] text-slate-400">—</span>;
  if (valor === 0) return <span className="text-[11px] font-medium text-slate-400">0%</span>;
  // Para "con observaciones" o "SLA vencidos", subir es malo.
  const bueno = malo ? valor < 0 : valor > 0;
  return (
    <span className={`text-[11px] font-medium tabular-nums ${bueno ? "text-emerald-600" : "text-rose-600"}`}>
      {valor > 0 ? "▲" : "▼"} {Math.abs(valor)}%
    </span>
  );
}

/**
 * Dashboard de Soporte: vista ejecutiva.
 *
 * Números y dos distribuciones, sin listas largas. Para el detalle está el
 * listado de Tickets, que es su propia página.
 */
export default function SoporteDashboardPage() {
  const [dias, setDias] = useState("30");
  const [datos, setDatos] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setError(null);
    apiSoporte<Dashboard>(`/api/soporte/dashboard?dias=${dias}`)
      .then((d) => vivo && setDatos(d))
      .catch((e: Error) => vivo && setError(e.message));
    return () => {
      vivo = false;
    };
  }, [dias]);

  const totalTipos = datos?.por_tipo.reduce((s, t) => s + t.cantidad, 0) ?? 0;

  return (
    <Pagina>
      <Encabezado
        titulo="Soporte"
        subtitulo="Vista general del estado de los tickets"
        acciones={
          <>
            <div className="w-48">
              <FancySelect size="sm" ariaLabel="Período" value={dias} onChange={setDias} options={PERIODOS} />
            </div>
            <Link href="/dashboard/soporte/tickets/nuevo" className={claseBoton("primario")}>
              <Plus className="h-4 w-4" aria-hidden /> Nuevo ticket
            </Link>
          </>
        }
      />

      {error ? <Aviso>{error}</Aviso> : null}

      {!datos && !error ? (
        <Cargando />
      ) : datos ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
            {KPIS.map((k) => (
              <div key={k.clave} className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                <p className="text-[11.5px] leading-tight text-slate-500">{k.etiqueta}</p>
                <p
                  className={`mt-1.5 text-2xl font-semibold tabular-nums ${
                    k.destacado && (datos.kpis[k.clave] ?? 0) > 0 ? "text-rose-600" : "text-slate-900"
                  }`}
                >
                  {datos.kpis[k.clave] ?? 0}
                </p>
                <div className="mt-1">
                  <Variacion valor={datos.variacion[k.clave]} malo={k.malo} />
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-5 lg:grid-cols-5">
            <Tarjeta titulo="Tickets por estado" className="lg:col-span-3">
              {datos.kpis.total === 0 ? (
                <Vacio titulo="Sin tickets en el período" />
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={datos.por_estado} margin={{ top: 20, right: 8, left: -18, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="#f1f5f9" />
                      <XAxis
                        dataKey="nombre"
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        tickLine={false}
                        axisLine={{ stroke: "#e2e8f0" }}
                        interval={0}
                        tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)}
                      />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                      <Tooltip
                        cursor={{ fill: "#f8fafc" }}
                        contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }}
                        formatter={(v) => [v, "Tickets"]}
                      />
                      <Bar dataKey="cantidad" radius={[4, 4, 0, 0]} maxBarSize={44}>
                        {datos.por_estado.map((e) => (
                          <Cell key={e.codigo} fill={e.color} />
                        ))}
                        <LabelList dataKey="cantidad" position="top" style={{ fontSize: 11, fill: "#475569" }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Tarjeta>

            <Tarjeta titulo="Por tipo de solicitud" className="lg:col-span-2">
              {totalTipos === 0 ? (
                <Vacio titulo="Sin tickets en el período" />
              ) : (
                <div className="flex flex-col items-center gap-5 sm:flex-row">
                  <div className="relative h-52 w-52 shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={datos.por_tipo} dataKey="cantidad" nameKey="nombre" innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke="none">
                          {datos.por_tipo.map((t, i) => (
                            <Cell key={t.nombre} fill={PALETA_TIPOS[i % PALETA_TIPOS.length]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 grid place-items-center">
                      <div className="text-center">
                        <p className="text-2xl font-semibold tabular-nums text-slate-900">{totalTipos}</p>
                        <p className="text-[11px] text-slate-500">tickets</p>
                      </div>
                    </div>
                  </div>
                  <ul className="w-full space-y-2">
                    {datos.por_tipo.map((t, i) => (
                      <li key={t.nombre} className="flex items-center justify-between gap-3 text-[13px]">
                        <span className="flex min-w-0 items-center gap-2 text-slate-600">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: PALETA_TIPOS[i % PALETA_TIPOS.length] }} aria-hidden />
                          <span className="truncate">{t.nombre}</span>
                        </span>
                        <span className="font-medium tabular-nums text-slate-800">{t.cantidad}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Tarjeta>
          </div>
        </div>
      ) : null}
    </Pagina>
  );
}
