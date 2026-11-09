"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarCheck2,
  CheckCircle2,
  CircleSlash,
  Download,
  LayoutGrid,
  ListChecks,
  PieChart,
  TrendingUp,
} from "lucide-react";
import CountUp from "@/components/reactbits/CountUp";
import { FechaSelect } from "@/components/ui/FechaSelect";
import { numeroTicket } from "@/lib/soporte/dominio";
import { apiSoporte } from "../_ui/api";
import {
  Aviso,
  Boton,
  Cargando,
  Encabezado,
  IconoTile,
  Pagina,
  TarjetaViva,
  Tarjeta,
  Vacio,
  claseEtiqueta,
  claseInput,
  type Tono,
} from "../_ui/ui";

// ---------------------------------------------------------------- tipos
type ItemDia = {
  id: string;
  numero: number | null;
  asunto: string | null;
  cliente: string | null;
  estado_codigo: string;
  estado_nombre: string;
  color: string;
  resuelto: boolean;
  hora: string;
};
type Dia = {
  fecha: string;
  etiqueta: string;
  total: number;
  resueltos: number;
  cancelados: number;
  porcentaje_resuelto: number;
  items: ItemDia[];
};
type Reporte = {
  desde: string;
  hasta: string;
  usuario: { id: string; nombre: string };
  total: number;
  resueltos: number;
  cancelados: number;
  porcentaje_resuelto: number | null;
  dias_con_cierres: number;
  promedio_por_dia: number;
  por_estado: { clave: string; nombre: string; cantidad: number; color: string }[];
  por_dia: Dia[];
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const primerDiaMes = () => {
  const d = new Date();
  return iso(new Date(d.getFullYear(), d.getMonth(), 1));
};

// ---------------------------------------------------------------- KPI
function Numero({
  etiqueta,
  valor,
  sufijo = "",
  detalle,
  icono,
  tono,
}: {
  etiqueta: string;
  valor: number | string;
  sufijo?: string;
  detalle?: React.ReactNode;
  icono: typeof CheckCircle2;
  tono: Tono;
}) {
  return (
    <TarjetaViva tono={tono} className="px-4 py-3.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11.5px] font-medium text-slate-500">{etiqueta}</p>
        <IconoTile icono={icono} tono={tono} tam="sm" />
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
        {typeof valor === "number" ? (
          <>
            <CountUp to={valor} duration={0.6} />
            {sufijo}
          </>
        ) : (
          valor
        )}
      </div>
      {detalle ? <p className="mt-0.5 text-[11.5px] text-slate-400">{detalle}</p> : null}
    </TarjetaViva>
  );
}

// ---------------------------------------------------------------- Donut
/** Gráfico de torta (anillo) en SVG puro: sin librerías, nítido y liviano. */
function Donut({
  datos,
  centroValor,
  centroTexto,
}: {
  datos: { nombre: string; cantidad: number; color: string }[];
  centroValor: string;
  centroTexto: string;
}) {
  const total = datos.reduce((s, d) => s + d.cantidad, 0);
  const R = 52;
  const C = 2 * Math.PI * R;
  let acumulado = 0;
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
      <svg viewBox="0 0 140 140" className="h-36 w-36 shrink-0 -rotate-90">
        <circle cx="70" cy="70" r={R} fill="none" stroke="#eef2f7" strokeWidth="16" />
        {total > 0 &&
          datos.map((d) => {
            const frac = d.cantidad / total;
            const dash = frac * C;
            const el = (
              <circle
                key={d.nombre}
                cx="70"
                cy="70"
                r={R}
                fill="none"
                stroke={d.color}
                strokeWidth="16"
                strokeDasharray={`${dash} ${C - dash}`}
                strokeDashoffset={-acumulado}
                strokeLinecap="butt"
              >
                <title>{`${d.nombre}: ${d.cantidad} (${Math.round(frac * 100)}%)`}</title>
              </circle>
            );
            acumulado += dash;
            return el;
          })}
        <g className="rotate-90" style={{ transformOrigin: "70px 70px" }}>
          <text x="70" y="66" textAnchor="middle" className="fill-slate-900 text-[22px] font-bold tabular-nums">
            {centroValor}
          </text>
          <text x="70" y="84" textAnchor="middle" className="fill-slate-400 text-[9px] font-semibold uppercase tracking-wide">
            {centroTexto}
          </text>
        </g>
      </svg>
      <ul className="w-full space-y-2">
        {datos.map((d) => {
          const pct = total ? Math.round((d.cantidad / total) * 100) : 0;
          return (
            <li key={d.nombre} className="flex items-center gap-2.5 text-[13px]">
              <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: d.color }} />
              <span className="flex-1 text-slate-600">{d.nombre}</span>
              <span className="font-semibold tabular-nums text-slate-800">{d.cantidad}</span>
              <span className="w-10 text-right tabular-nums text-slate-400">{pct}%</span>
            </li>
          );
        })}
        {total === 0 ? <li className="text-[13px] text-slate-400">Sin datos</li> : null}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- Barras por día
function BarrasPorDia({ dias, onDia }: { dias: Dia[]; onDia: (fecha: string) => void }) {
  if (!dias.length) return <p className="py-4 text-center text-[13px] text-slate-400">Sin cierres en el período</p>;
  const max = Math.max(...dias.map((d) => d.total), 1);
  return (
    <ul className="space-y-2.5">
      {dias.map((d) => (
        <li key={d.fecha}>
          <button
            type="button"
            onClick={() => onDia(d.fecha)}
            className="grid w-full grid-cols-[52px_1fr_auto] items-center gap-3 rounded-lg px-1 py-0.5 text-left text-[12.5px] transition hover:bg-slate-50"
            title="Ver los tickets de este día"
          >
            <span className="font-semibold tabular-nums text-slate-500">{d.etiqueta}</span>
            <span className="flex h-3.5 overflow-hidden rounded-full bg-slate-100">
              <span className="h-full bg-emerald-400/90 transition-[width] duration-500" style={{ width: `${(d.resueltos / max) * 100}%` }} />
              <span className="h-full bg-rose-300 transition-[width] duration-500" style={{ width: `${(d.cancelados / max) * 100}%` }} />
            </span>
            <span className="flex items-center gap-2 tabular-nums">
              <span className="font-semibold text-slate-800">{d.total}</span>
              <span className="text-[11px] text-emerald-600">{d.porcentaje_resuelto}%</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- Lista de un día
function ListaDia({ dia }: { dia: Dia }) {
  return (
    <div className="divide-y divide-slate-100">
      {dia.items.map((t) => (
        <div key={t.id} className="flex items-center gap-3 px-1 py-2.5 text-[13px]">
          <span className="w-12 shrink-0 tabular-nums text-[11.5px] text-slate-400">{t.hora}</span>
          <a
            href={`/dashboard/soporte/tickets/${t.id}`}
            className="min-w-0 flex-1 truncate text-slate-700 no-underline hover:text-[#2F6E71]"
            title={t.asunto ?? ""}
          >
            <span className="tabular-nums text-slate-400">{numeroTicket(t.numero)}</span> {t.asunto}
            {t.cliente ? <span className="text-slate-400"> · {t.cliente}</span> : null}
          </a>
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold"
            style={{ color: t.color, background: `${t.color}1f` }}
          >
            {t.estado_nombre}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- CSV
function descargarCsv(datos: Reporte) {
  const enc = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const filas = [["Fecha", "Hora", "Ticket", "Asunto", "Cliente", "Estado", "Resuelto"]];
  for (const d of datos.por_dia)
    for (const t of d.items)
      filas.push([
        d.etiqueta,
        t.hora,
        numeroTicket(t.numero),
        t.asunto ?? "",
        t.cliente ?? "",
        t.estado_nombre,
        t.resuelto ? "Sí" : "No",
      ].map(enc) as string[]);
  const csv = "﻿" + filas.map((f) => f.join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `mis-cierres_${datos.desde}_${datos.hasta}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------- Página
export default function MisCierresPage() {
  const [desde, setDesde] = useState(primerDiaMes);
  const [hasta, setHasta] = useState(() => iso(new Date()));
  const [datos, setDatos] = useState<Reporte | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("resumen"); // "resumen" | fecha YYYY-MM-DD

  useEffect(() => {
    const q = new URLSearchParams({ desde, hasta });
    let vivo = true;
    setCargando(true);
    setError(null);
    apiSoporte<Reporte>(`/api/soporte/reportes/mis-cierres?${q.toString()}`)
      .then((r) => {
        if (!vivo) return;
        setDatos(r);
        setTab("resumen");
      })
      .catch((e: Error) => vivo && setError(e.message))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [desde, hasta]);

  const donut = useMemo(
    () => (datos ? datos.por_estado.map((e) => ({ nombre: e.nombre, cantidad: e.cantidad, color: e.color })) : []),
    [datos]
  );
  const diaActivo = useMemo(() => datos?.por_dia.find((d) => d.fecha === tab) ?? null, [datos, tab]);

  return (
    <Pagina>
      <Encabezado
        titulo="Lo que cerré"
        subtitulo="Tickets que vos cerraste en el período, día por día"
        icono={CalendarCheck2}
        tono="verde"
        acciones={
          datos && datos.total > 0 ? (
            <Boton variante="secundario" tam="sm" onClick={() => descargarCsv(datos)}>
              <Download className="h-4 w-4" /> Exportar CSV
            </Boton>
          ) : undefined
        }
      />

      <Tarjeta className="mb-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <span className={claseEtiqueta}>Desde</span>
            <FechaSelect value={desde} onChange={(e) => e.target.value && setDesde(e.target.value)} className={claseInput} max={hasta} anioDesde={2024} />
          </div>
          <div>
            <span className={claseEtiqueta}>Hasta</span>
            <FechaSelect value={hasta} onChange={(e) => e.target.value && setHasta(e.target.value)} className={claseInput} min={desde} anioDesde={2024} />
          </div>
        </div>
      </Tarjeta>

      {error ? <Aviso>{error}</Aviso> : null}
      {!datos ? (
        error ? null : <Cargando />
      ) : (
        <div className={`space-y-5 ${cargando ? "opacity-60" : ""}`}>
          {datos.total === 0 ? (
            <Tarjeta>
              <Vacio icono={CalendarCheck2} tono="verde" titulo="No cerraste tickets en este período" detalle="Probá ampliar el rango de fechas." />
            </Tarjeta>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Numero etiqueta="Tickets que cerré" valor={datos.total} icono={ListChecks} tono="turquesa" detalle={`${datos.dias_con_cierres} día(s) con cierres`} />
                <Numero etiqueta="% resuelto" valor={datos.porcentaje_resuelto ?? 0} sufijo="%" icono={CheckCircle2} tono="verde" detalle={`${datos.resueltos} resueltos`} />
                <Numero etiqueta="Cancelados" valor={datos.cancelados} icono={CircleSlash} tono="rosa" detalle="No resueltos" />
                <Numero etiqueta="Promedio por día" valor={datos.promedio_por_dia} icono={TrendingUp} tono="violeta" detalle="Cierres / día activo" />
              </div>

              <div className="grid gap-5 lg:grid-cols-2">
                <Tarjeta titulo="Resueltos vs. cancelados" icono={PieChart} tono="verde">
                  <Donut datos={donut} centroValor={`${datos.porcentaje_resuelto ?? 0}%`} centroTexto="resuelto" />
                </Tarjeta>
                <Tarjeta titulo="Cierres por día" icono={CalendarCheck2} tono="turquesa">
                  <BarrasPorDia dias={datos.por_dia} onDia={(f) => setTab(f)} />
                  <p className="mt-3 flex items-center gap-3 text-[11px] text-slate-400">
                    <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-400/90" /> Resuelto</span>
                    <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-rose-300" /> Cancelado</span>
                    <span>· tocá un día para ver el detalle</span>
                  </p>
                </Tarjeta>
              </div>

              {/* Pestañas: Resumen + una por día */}
              <Tarjeta padding="p-0">
                <div className="flex gap-1.5 overflow-x-auto border-b border-slate-100 p-2.5">
                  <button
                    type="button"
                    onClick={() => setTab("resumen")}
                    className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-[13px] font-semibold transition ${
                      tab === "resumen" ? "bg-[#4FAEB2] text-white shadow-[0_6px_16px_-8px_rgba(79,174,178,0.9)]" : "text-slate-500 hover:bg-[#4FAEB2]/8 hover:text-[#2F6E71]"
                    }`}
                  >
                    <LayoutGrid className="h-4 w-4" /> Todos ({datos.total})
                  </button>
                  {datos.por_dia.map((d) => {
                    const sel = tab === d.fecha;
                    return (
                      <button
                        key={d.fecha}
                        type="button"
                        onClick={() => setTab(d.fecha)}
                        className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-[13px] font-semibold transition ${
                          sel ? "bg-[#4FAEB2] text-white shadow-[0_6px_16px_-8px_rgba(79,174,178,0.9)]" : "text-slate-500 hover:bg-[#4FAEB2]/8 hover:text-[#2F6E71]"
                        }`}
                      >
                        {d.etiqueta}
                        <span className={`rounded-full px-1.5 text-[11px] font-bold tabular-nums ${sel ? "bg-white/25 text-white" : "bg-slate-100 text-slate-500"}`}>
                          {d.total}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="p-4">
                  {tab === "resumen" ? (
                    <div className="space-y-5">
                      {datos.por_dia.map((d) => (
                        <div key={d.fecha}>
                          <div className="mb-1 flex items-center justify-between">
                            <h3 className="text-[13px] font-semibold text-slate-700">
                              {d.etiqueta}
                              <span className="ml-2 font-normal text-slate-400">{d.total} cerrado(s) · {d.porcentaje_resuelto}% resuelto</span>
                            </h3>
                          </div>
                          <ListaDia dia={d} />
                        </div>
                      ))}
                    </div>
                  ) : diaActivo ? (
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <h3 className="text-[13px] font-semibold text-slate-700">
                          {diaActivo.etiqueta}
                          <span className="ml-2 font-normal text-slate-400">{diaActivo.total} cerrado(s) · {diaActivo.resueltos} resuelto(s) · {diaActivo.cancelados} cancelado(s)</span>
                        </h3>
                      </div>
                      <ListaDia dia={diaActivo} />
                    </div>
                  ) : (
                    <Vacio icono={CalendarCheck2} tono="verde" titulo="Sin cierres este día" />
                  )}
                </div>
              </Tarjeta>
            </>
          )}
        </div>
      )}
    </Pagina>
  );
}
