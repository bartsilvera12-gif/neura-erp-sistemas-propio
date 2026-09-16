"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  AlarmClock,
  BarChart3,
  CheckCircle2,
  Code2,
  FlaskConical,
  Headphones,
  Inbox,
  ListChecks,
  Lock,
  MessageSquareWarning,
  PieChart as IconoTorta,
  Plus,
  Ticket,
  UserRoundCheck,
  type LucideIcon,
} from "lucide-react";
import CountUp from "@/components/reactbits/CountUp";
import { FancySelect } from "@/app/dashboard/proyectos/components/FancySelect";
import { apiSoporte } from "./_ui/api";
import { Aviso, Encabezado, Esqueleto, IconoTile, PALETA_TIPOS, Pagina, TONOS, Tarjeta, TarjetaViva, Vacio, claseBoton, type Tono } from "./_ui/ui";

const GraficoEstados = dynamic(() => import("./_ui/GraficosDashboard").then((m) => m.GraficoEstados), {
  ssr: false,
  loading: () => <Esqueleto className="h-full w-full rounded-xl" />,
});
const GraficoTipos = dynamic(() => import("./_ui/GraficosDashboard").then((m) => m.GraficoTipos), {
  ssr: false,
  loading: () => <Esqueleto className="h-full w-full rounded-full" />,
});

type Dashboard = {
  dias: number;
  kpis: Record<string, number>;
  variacion: Record<string, number | null>;
  por_estado: { codigo: string; nombre: string; color: string; cantidad: number }[];
  por_tipo: { nombre: string; cantidad: number }[];
};

const KPIS: { clave: string; etiqueta: string; icono: LucideIcon; tono: Tono; malo?: boolean; href: string }[] = [
  { clave: "total", etiqueta: "Total de tickets", icono: Ticket, tono: "turquesa", href: "/dashboard/soporte/tickets" },
  { clave: "pendientes", etiqueta: "Pendientes", icono: Inbox, tono: "azul", href: "/dashboard/soporte/tickets?pestana=pendientes" },
  { clave: "en_proceso", etiqueta: "En proceso", icono: Code2, tono: "celeste", href: "/dashboard/soporte/tickets?pestana=en_proceso" },
  { clave: "falta_informacion", etiqueta: "Falta información", icono: MessageSquareWarning, tono: "ambar", malo: true, href: "/dashboard/soporte/tickets?pestana=falta_informacion" },
  { clave: "en_revision", etiqueta: "En revisión", icono: FlaskConical, tono: "violeta", href: "/dashboard/soporte/tickets?pestana=revision" },
  { clave: "resueltos", etiqueta: "Resueltos", icono: CheckCircle2, tono: "verde", href: "/dashboard/soporte/tickets?pestana=resueltos" },
  { clave: "cerrados", etiqueta: "Cerrados / cancelados", icono: Lock, tono: "pizarra", href: "/dashboard/soporte/tickets?pestana=cerrados" },
  { clave: "sla_vencidos", etiqueta: "SLA vencidos", icono: AlarmClock, tono: "rosa", malo: true, href: "/dashboard/soporte/tickets" },
];

const ACCESOS: { titulo: string; detalle: string; href: string; icono: LucideIcon; tono: Tono }[] = [
  { titulo: "Cargar ticket", detalle: "Desde la tipificación del cliente", href: "/gestion-clientes", icono: Plus, tono: "turquesa" },
  { titulo: "Mis tickets", detalle: "Donde tenés la próxima acción", href: "/dashboard/soporte/mis-tickets", icono: UserRoundCheck, tono: "violeta" },
  { titulo: "Todos los tickets", detalle: "Listado con filtros", href: "/dashboard/soporte/tickets", icono: ListChecks, tono: "celeste" },
  { titulo: "Reportes", detalle: "SLA, tiempos y devoluciones", href: "/dashboard/soporte/reportes", icono: BarChart3, tono: "ambar" },
];

const PERIODOS = [
  { value: "7", label: "Últimos 7 días" },
  { value: "30", label: "Últimos 30 días" },
  { value: "90", label: "Últimos 90 días" },
  { value: "0", label: "Todo el historial" },
];

// El último dashboard pedido, por período: volver a la pantalla la pinta al
// instante con lo que había, y se actualiza en silencio.
const recordado = new Map<string, Dashboard>();

function Variacion({ valor, malo }: { valor: number | null | undefined; malo?: boolean }) {
  if (valor == null) return <span className="text-[11px] text-slate-400">sin comparación</span>;
  if (valor === 0) return <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-slate-500">= 0%</span>;
  const bueno = malo ? valor < 0 : valor > 0;
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[10.5px] font-bold tabular-nums ${bueno ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}>
      {valor > 0 ? "▲" : "▼"} {Math.abs(valor)}%
    </span>
  );
}

/**
 * Dashboard de Soporte: la vista ejecutiva, y la puerta de entrada del módulo.
 *
 * Cada KPI es un atajo: clic y abre el listado ya filtrado por eso. Los
 * accesos rápidos cubren lo que se hace todos los días sin pasar por el menú.
 */
export default function SoporteDashboardPage() {
  const [dias, setDias] = useState("30");
  const [datos, setDatos] = useState<Dashboard | null>(() => recordado.get("30") ?? null);
  const [error, setError] = useState<string | null>(null);

  // PM, QA y Desarrollo no ven el Dashboard: van directo a los tickets.
  const router = useRouter();
  useEffect(() => {
    let vivo = true;
    apiSoporte<{ dashboard: boolean }>("/api/soporte/acceso")
      .then((a) => {
        if (vivo && !a.dashboard) router.replace("/dashboard/soporte/mis-tickets");
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [router]);

  useEffect(() => {
    let vivo = true;
    const guardado = recordado.get(dias);
    if (guardado) setDatos(guardado);
    apiSoporte<Dashboard>(`/api/soporte/dashboard?dias=${dias}`)
      .then((d) => {
        recordado.set(dias, d);
        if (vivo) {
          setDatos(d);
          setError(null);
        }
      })
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
        icono={Headphones}
        acciones={
          <>
            <div className="w-48">
              <FancySelect size="sm" ariaLabel="Período" value={dias} onChange={setDias} options={PERIODOS} />
            </div>
            {/* Los tickets nacen de la tipificación del cliente. */}
            <Link href="/gestion-clientes" className={claseBoton("primario")} title="Los tickets se cargan desde la tipificación del cliente">
              <Plus className="h-4 w-4" aria-hidden /> Cargar ticket
            </Link>
          </>
        }
      />

      {error ? <div className="mb-4"><Aviso>{error}</Aviso></div> : null}

      <div className="space-y-5">
        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
          {KPIS.map((k) => {
            const valor = datos?.kpis[k.clave] ?? 0;
            const alerta = k.clave === "sla_vencidos" && valor > 0;
            return (
              <Link key={k.clave} href={k.href} className="group no-underline" prefetch>
                <TarjetaViva tono={k.tono} className={`h-full px-4 py-3.5 ${alerta ? "!border-rose-200 bg-rose-50/40" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <IconoTile icono={k.icono} tono={k.tono} tam="sm" />
                    {datos ? <Variacion valor={datos.variacion[k.clave]} malo={k.malo} /> : null}
                  </div>
                  <div className={`mt-3 text-[26px] font-bold leading-none tabular-nums ${alerta ? "text-rose-600" : "text-slate-900"}`}>
                    {datos ? <CountUp to={valor} duration={0.6} /> : <Esqueleto className="h-6 w-10" />}
                  </div>
                  <p className="mt-1.5 text-[12px] font-medium leading-tight text-slate-500 group-hover:text-slate-700">{k.etiqueta}</p>
                  <span className={`absolute inset-x-0 bottom-0 h-0.5 origin-left scale-x-0 transition-transform duration-300 group-hover:scale-x-100 ${TONOS[k.tono].solido}`} aria-hidden />
                </TarjetaViva>
              </Link>
            );
          })}
        </div>

        {/* Accesos rápidos */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {ACCESOS.map((a) => (
            <Link key={a.href} href={a.href} className="no-underline" prefetch>
              <TarjetaViva tono={a.tono} className="flex items-center gap-3.5 px-4 py-4">
                <IconoTile icono={a.icono} tono={a.tono} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-800">{a.titulo}</span>
                  <span className="block truncate text-[12.5px] text-slate-500">{a.detalle}</span>
                </span>
              </TarjetaViva>
            </Link>
          ))}
        </div>

        {/* Gráficos */}
        <div className="grid gap-5 lg:grid-cols-5">
          <Tarjeta titulo="Tickets por estado" icono={BarChart3} tono="celeste" className="lg:col-span-3">
            <div className="h-72">
              {!datos ? (
                <Esqueleto className="h-full w-full rounded-xl" />
              ) : datos.kpis.total === 0 ? (
                <Vacio titulo="Sin tickets en el período" icono={Ticket} />
              ) : (
                <GraficoEstados datos={datos.por_estado} />
              )}
            </div>
          </Tarjeta>

          <Tarjeta titulo="Por tipo de solicitud" icono={IconoTorta} tono="violeta" className="lg:col-span-2">
            {!datos ? (
              <Esqueleto className="h-56 w-full rounded-xl" />
            ) : totalTipos === 0 ? (
              <Vacio titulo="Sin tickets en el período" icono={IconoTorta} tono="violeta" />
            ) : (
              <div className="flex flex-col items-center gap-5 sm:flex-row">
                <div className="relative h-52 w-52 shrink-0">
                  <GraficoTipos datos={datos.por_tipo} />
                  <div className="pointer-events-none absolute inset-0 grid place-items-center">
                    <div className="text-center">
                      <p className="text-3xl font-bold tabular-nums text-slate-900">
                        <CountUp to={totalTipos} duration={0.6} />
                      </p>
                      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">tickets</p>
                    </div>
                  </div>
                </div>
                <ul className="w-full space-y-2.5">
                  {datos.por_tipo.map((t, i) => {
                    const pct = Math.round((t.cantidad / totalTipos) * 100);
                    const color = PALETA_TIPOS[i % PALETA_TIPOS.length];
                    return (
                      <li key={t.nombre}>
                        <div className="flex items-center justify-between gap-3 text-[13px]">
                          <span className="flex min-w-0 items-center gap-2 font-medium text-slate-700">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
                            <span className="truncate">{t.nombre}</span>
                          </span>
                          <span className="font-bold tabular-nums text-slate-800">{t.cantidad}</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </Tarjeta>
        </div>
      </div>
    </Pagina>
  );
}
