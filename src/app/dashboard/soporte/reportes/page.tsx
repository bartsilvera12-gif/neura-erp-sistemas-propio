"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, Building2, CalendarRange, CheckCircle2, CircleDot, Flag, RotateCcw, Tags, Ticket, Timer, TimerOff, UserRound, type LucideIcon } from "lucide-react";
import CountUp from "@/components/reactbits/CountUp";
import { FancySelect } from "@/app/dashboard/proyectos/components/FancySelect";
import SmartCombobox from "@/components/ui/SmartCombobox";
import { FechaSelect } from "@/components/ui/FechaSelect";
import { duracionCorta } from "@/lib/soporte/dominio";
import { apiSoporte, obtenerCatalogos, obtenerClientes, type CatalogosConEquipo } from "../_ui/api";
import { Aviso, Cargando, Encabezado, IconoTile, Pagina, TONOS, Tarjeta, TarjetaViva, Vacio, claseEtiqueta, claseInput, type Tono } from "../_ui/ui";

type Conteo = { clave: string; nombre: string; cantidad: number };
type Reporte = {
  desde: string;
  hasta: string;
  total: number;
  por_periodo: Conteo[];
  por_cliente: Conteo[];
  por_tipo: Conteo[];
  por_prioridad: Conteo[];
  por_responsable: Conteo[];
  por_estado: Conteo[];
  sla: { cumplidos: number; incumplidos: number; vencidos_abiertos: number; en_curso: number; porcentaje_cumplimiento: number | null };
  resolucion: { resueltos: number; promedio_ms: number | null };
  devoluciones_qa: { total: number; tickets_devueltos: number; mas_devueltos: { id: string; numero: number; asunto: string; devoluciones: number }[] };
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Barras horizontales simples: se leen de un vistazo y no piden una librería. */
function Barras({ datos, vacio = "Sin datos", tono = "turquesa" }: { datos: Conteo[]; vacio?: string; tono?: Tono }) {
  if (!datos.length) return <p className="py-4 text-center text-[13px] text-slate-400">{vacio}</p>;
  const max = Math.max(...datos.map((d) => d.cantidad), 1);
  return (
    <ul className="space-y-2">
      {datos.map((d) => (
        <li key={d.clave || d.nombre} className="grid grid-cols-[minmax(0,140px)_1fr_36px] items-center gap-3 text-[12.5px]">
          <span className="truncate text-slate-600" title={d.nombre}>{d.nombre}</span>
          <span className="h-2 overflow-hidden rounded-full bg-slate-100">
            <span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${(d.cantidad / max) * 100}%`, background: `linear-gradient(90deg, ${TONOS[tono].hex}99, ${TONOS[tono].hex})` }} />
          </span>
          <span className="text-right font-medium tabular-nums text-slate-800">{d.cantidad}</span>
        </li>
      ))}
    </ul>
  );
}

function Numero({
  etiqueta,
  valor,
  sufijo = "",
  detalle,
  alerta,
  icono,
  tono,
}: {
  etiqueta: string;
  valor: number | string;
  sufijo?: string;
  detalle?: React.ReactNode;
  alerta?: boolean;
  icono: LucideIcon;
  tono: Tono;
}) {
  const t: Tono = alerta ? "rosa" : tono;
  return (
    <TarjetaViva tono={t} className="px-4 py-3.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11.5px] font-medium text-slate-500">{etiqueta}</p>
        <IconoTile icono={icono} tono={t} tam="sm" />
      </div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${alerta ? "text-rose-600" : "text-slate-900"}`}>
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

export default function SoporteReportesPage() {
  const hoy = useMemo(() => new Date(), []);
  const [desde, setDesde] = useState(iso(new Date(hoy.getTime() - 30 * 86_400_000)));
  const [hasta, setHasta] = useState(iso(hoy));
  const [clienteId, setClienteId] = useState("");
  const [responsableId, setResponsableId] = useState("");
  const [tipo, setTipo] = useState("");
  const [estado, setEstado] = useState("");
  const [cat, setCat] = useState<CatalogosConEquipo | null>(null);
  const [clientes, setClientes] = useState<{ id: string; nombre: string }[]>([]);
  const [datos, setDatos] = useState<Reporte | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void obtenerCatalogos().then(setCat).catch(() => {});
    void obtenerClientes().then(setClientes).catch(() => {});
  }, []);

  useEffect(() => {
    const q = new URLSearchParams({ desde, hasta });
    if (clienteId) q.set("cliente_id", clienteId);
    if (responsableId) q.set("responsable_id", responsableId);
    if (tipo) q.set("tipo", tipo);
    if (estado) q.set("estado", estado);
    let vivo = true;
    setCargando(true);
    setError(null);
    apiSoporte<Reporte>(`/api/soporte/reportes?${q.toString()}`)
      .then((r) => vivo && setDatos(r))
      .catch((e: Error) => vivo && setError(e.message))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [desde, hasta, clienteId, responsableId, tipo, estado]);

  return (
    <Pagina>
      <Encabezado titulo="Reportes" subtitulo="Indicadores de soporte del período" icono={BarChart3} tono="indigo" />

      <Tarjeta className="mb-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div>
            <span className={claseEtiqueta}>Desde</span>
            <FechaSelect value={desde} onChange={(e) => e.target.value && setDesde(e.target.value)} className={claseInput} max={hasta} anioDesde={2024} />
          </div>
          <div>
            <span className={claseEtiqueta}>Hasta</span>
            <FechaSelect value={hasta} onChange={(e) => e.target.value && setHasta(e.target.value)} className={claseInput} min={desde} anioDesde={2024} />
          </div>
          <div>
            <span className={claseEtiqueta}>Cliente</span>
            <SmartCombobox options={clientes.map((c) => ({ id: c.id, label: c.nombre }))} value={clienteId || null} onChange={(v) => setClienteId(v ?? "")} placeholder="Todos" />
          </div>
          <div>
            <span className={claseEtiqueta}>Responsable</span>
            <FancySelect ariaLabel="Responsable" value={responsableId} onChange={setResponsableId} options={[{ value: "", label: "Todos" }, ...(cat?.personas ?? []).map((p) => ({ value: p.id, label: p.nombre }))]} />
          </div>
          <div>
            <span className={claseEtiqueta}>Tipo</span>
            <FancySelect ariaLabel="Tipo" value={tipo} onChange={setTipo} options={[{ value: "", label: "Todos" }, ...(cat?.tipos ?? []).map((t) => ({ value: t.codigo, label: t.nombre }))]} />
          </div>
          <div>
            <span className={claseEtiqueta}>Estado</span>
            <FancySelect ariaLabel="Estado" value={estado} onChange={setEstado} options={[{ value: "", label: "Todos" }, ...(cat?.estados ?? []).map((e) => ({ value: e.codigo, label: e.nombre }))]} />
          </div>
        </div>
      </Tarjeta>

      {error ? <Aviso>{error}</Aviso> : null}
      {!datos ? (
        error ? null : <Cargando />
      ) : (
        <div className={`space-y-5 ${cargando ? "opacity-60" : ""}`}>
          {datos.total === 0 ? (
            <Tarjeta><Vacio icono={BarChart3} tono="indigo" titulo="No hay tickets en el período con esos filtros" /></Tarjeta>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <Numero etiqueta="Tickets en el período" valor={datos.total} icono={Ticket} tono="turquesa" />
                <Numero
                  etiqueta="Cumplimiento de SLA"
                  valor={datos.sla.porcentaje_cumplimiento ?? "—"}
                  sufijo="%"
                  icono={CheckCircle2}
                  tono="verde"
                  detalle={`${datos.sla.cumplidos} cumplidos · ${datos.sla.incumplidos} incumplidos`}
                  alerta={datos.sla.porcentaje_cumplimiento != null && datos.sla.porcentaje_cumplimiento < 80}
                />
                <Numero etiqueta="SLA vencidos (abiertos)" valor={datos.sla.vencidos_abiertos} icono={TimerOff} tono="naranja" alerta={datos.sla.vencidos_abiertos > 0} detalle={`${datos.sla.en_curso} en curso`} />
                <Numero etiqueta="Tiempo medio de resolución" valor={duracionCorta(datos.resolucion.promedio_ms)} icono={Timer} tono="celeste" detalle={`${datos.resolucion.resueltos} resueltos · horas laborales`} />
                <Numero etiqueta="Devoluciones de QA" valor={datos.devoluciones_qa.total} icono={RotateCcw} tono="violeta" detalle={`en ${datos.devoluciones_qa.tickets_devueltos} ticket(s)`} alerta={datos.devoluciones_qa.total > 0} />
              </div>

              <div className="grid gap-5 lg:grid-cols-2">
                <Tarjeta titulo="Tickets por período" icono={CalendarRange} tono="turquesa"><Barras datos={datos.por_periodo} tono="turquesa" /></Tarjeta>
                <Tarjeta titulo="Tickets por estado" icono={CircleDot} tono="celeste"><Barras datos={datos.por_estado} tono="celeste" /></Tarjeta>
                <Tarjeta titulo="Tickets por cliente" icono={Building2} tono="indigo"><Barras datos={datos.por_cliente} tono="indigo" /></Tarjeta>
                <Tarjeta titulo="Tickets por responsable" icono={UserRound} tono="verde"><Barras datos={datos.por_responsable} tono="verde" /></Tarjeta>
                <Tarjeta titulo="Tickets por tipo" icono={Tags} tono="violeta"><Barras datos={datos.por_tipo} tono="violeta" /></Tarjeta>
                <Tarjeta titulo="Tickets por prioridad" icono={Flag} tono="ambar"><Barras datos={datos.por_prioridad} tono="ambar" /></Tarjeta>
              </div>

              <Tarjeta titulo="Tickets con más devoluciones de QA" icono={RotateCcw} tono="rosa" padding="p-0">
                {datos.devoluciones_qa.mas_devueltos.length === 0 ? (
                  <Vacio icono={RotateCcw} tono="verde" titulo="Sin devoluciones de QA en el período" />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {datos.devoluciones_qa.mas_devueltos.map((t) => (
                      <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-[13px]">
                        <a href={`/dashboard/soporte/tickets/${t.id}`} className="min-w-0 truncate text-slate-700 no-underline hover:text-[#2F6E71]">
                          <span className="tabular-nums text-slate-400">#{t.numero}</span> {t.asunto}
                        </a>
                        <span className="shrink-0 font-semibold tabular-nums text-rose-600">{t.devoluciones}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Tarjeta>
            </>
          )}
        </div>
      )}
    </Pagina>
  );
}
