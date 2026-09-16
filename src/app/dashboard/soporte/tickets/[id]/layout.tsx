"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Building2,
  CalendarCheck,
  CalendarPlus,
  Clock3,
  FileText,
  Headset,
  History,
  Layers,
  ListChecks,
  Link2,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Pencil,
  RefreshCw,
  Tag,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { duracionCorta } from "@/lib/soporte/dominio";
import {
  catalogosEnMemoria,
  fechaHora,
  obtenerCatalogos,
  obtenerTicket,
  ticketEnMemoria,
  type CatalogosConEquipo,
} from "../../_ui/api";
import { TicketContext, type TicketCtx, type TicketDetalle } from "../../_ui/TicketContexto";
import EstadoRapido from "../../_ui/EstadoRapido";
import { Aviso, Esqueleto, Insignia, Pagina, PestanasRuta, TONOS, claseBoton, type Tono } from "../../_ui/ui";

type Detalle = { ticket: TicketDetalle; contadores: TicketCtx["contadores"] };

const SLA: Record<string, { barra: string; texto: string; fondo: string; etiqueta: string }> = {
  en_tiempo: { barra: "bg-gradient-to-r from-emerald-400 to-emerald-500", texto: "text-emerald-700", fondo: "bg-emerald-50", etiqueta: "En tiempo" },
  en_riesgo: { barra: "bg-gradient-to-r from-amber-400 to-amber-500", texto: "text-amber-700", fondo: "bg-amber-50", etiqueta: "En riesgo" },
  vencido: { barra: "bg-gradient-to-r from-rose-400 to-rose-500", texto: "text-rose-700", fondo: "bg-rose-50", etiqueta: "Vencido" },
  cumplido: { barra: "bg-gradient-to-r from-emerald-400 to-emerald-500", texto: "text-emerald-700", fondo: "bg-emerald-50", etiqueta: "Cumplido" },
  incumplido: { barra: "bg-gradient-to-r from-rose-400 to-rose-500", texto: "text-rose-700", fondo: "bg-rose-50", etiqueta: "Incumplido" },
  sin_sla: { barra: "bg-slate-300", texto: "text-slate-500", fondo: "bg-slate-50", etiqueta: "Sin SLA" },
};

/** Dato compacto del resumen: ícono chico en la etiqueta, valor en una línea. */
function Dato({
  etiqueta,
  icono: Icono,
  tono,
  extra,
  children,
}: {
  etiqueta: string;
  icono: LucideIcon;
  tono: Tono;
  /** Acción chica a la derecha de la etiqueta (p. ej. "Sus tickets"). */
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
        <Icono className={`h-3.5 w-3.5 shrink-0 ${TONOS[tono].texto}`} strokeWidth={2.2} aria-hidden />
        <span className="truncate">{etiqueta}</span>
        {extra}
      </p>
      <div className="mt-0.5 truncate text-[13px] font-semibold text-slate-800">{children}</div>
    </div>
  );
}

/**
 * Marco del detalle de un ticket: encabezado, resumen y pestañas.
 *
 * Es un LAYOUT: cada pestaña es una ruta real (/comentarios, /archivos, …) que
 * se puede recargar o compartir. El ticket se pide una vez y se comparte por
 * contexto. Si la tabla ya lo precargó al pasar el mouse, abre armado.
 */
export default function TicketLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const [detalle, setDetalle] = useState<Detalle | null>(() => ticketEnMemoria<Detalle>(id) ?? null);
  const [catalogos, setCatalogos] = useState<CatalogosConEquipo | null>(() => catalogosEnMemoria() ?? null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  // Momento de la carga, para marcar la entrega vencida sin leer el reloj en cada render.
  const [ahora] = useState(() => Date.now());
  const menuRef = useRef<HTMLDivElement>(null);

  const recargar = useCallback(async () => {
    try {
      const [d, c] = await Promise.all([obtenerTicket<Detalle>(id, true), obtenerCatalogos()]);
      setDetalle(d);
      setCatalogos(c);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el ticket");
    }
  }, [id]);

  useEffect(() => {
    let vivo = true;
    // Si ya había algo en memoria se muestra y se refresca en silencio.
    Promise.all([obtenerTicket<Detalle>(id), obtenerCatalogos()])
      .then(([d, c]) => {
        if (!vivo) return;
        setDetalle(d);
        setCatalogos(c);
      })
      .catch((e: Error) => vivo && setError(e.message));
    return () => {
      vivo = false;
    };
  }, [id]);

  useEffect(() => {
    if (!menu) return;
    const cerrar = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", cerrar);
    return () => document.removeEventListener("mousedown", cerrar);
  }, [menu]);

  if (error && !detalle) {
    return (
      <Pagina>
        <Aviso>{error}</Aviso>
        <Link href="/dashboard/soporte/tickets" className={`${claseBoton("secundario")} mt-4`}>Volver a Tickets</Link>
      </Pagina>
    );
  }

  if (!detalle || !catalogos) {
    return (
      <Pagina>
        <Esqueleto className="mb-3 h-4 w-40" />
        <Esqueleto className="mb-5 h-8 w-2/3" />
        <Esqueleto className="mb-5 h-36 w-full rounded-2xl" />
        <Esqueleto className="h-12 w-full rounded-2xl" />
      </Pagina>
    );
  }

  const t = detalle.ticket;
  const base = `/dashboard/soporte/tickets/${t.id}`;
  const editando = pathname.endsWith("/editar");
  const sla = SLA[t.sla.estado] ?? SLA.sin_sla;
  const proporcion = t.sla.proporcion == null ? 0 : Math.min(1, t.sla.proporcion);
  const activo = (["comentarios", "archivos", "historial", "relaciones"] as const).find((x) => pathname.endsWith(`/${x}`)) ?? "descripcion";
  const ctx: TicketCtx = { ticket: t, contadores: detalle.contadores, catalogos, recargar };

  return (
    <TicketContext.Provider value={ctx}>
      <Pagina>
        <nav className="mb-3 flex items-center gap-1.5 text-[12px] text-slate-400" aria-label="Ruta">
          <Link href="/dashboard/soporte/tickets" className="font-semibold text-[#2F6E71] no-underline hover:underline">Tickets</Link>
          <span aria-hidden>›</span>
          <Link href={base} className="font-medium text-slate-500 no-underline hover:underline">#{t.numero}</Link>
          {editando ? (<><span aria-hidden>›</span><span>Editar</span></>) : null}
        </nav>

        {/* Encabezado con el color del estado: se sabe dónde está el ticket antes de leer. */}
        <header
          className="relative mb-5 overflow-hidden rounded-2xl border border-slate-200/80 bg-white px-5 py-4 shadow-[0_1px_3px_rgba(15,23,42,0.05),0_8px_24px_-12px_rgba(15,23,42,0.08)]"
          style={{ backgroundImage: `linear-gradient(110deg, ${t.estado_color}14 0%, transparent 45%)` }}
        >
          <span className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundColor: t.estado_color }} aria-hidden />
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-[22px] font-bold leading-snug tracking-tight text-slate-900">
                <span className="mr-2 rounded-lg bg-slate-900/[0.06] px-2 py-0.5 text-[16px] font-bold tabular-nums text-slate-500">#{t.numero}</span>
                {t.asunto}
              </h1>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <Insignia color={t.estado_color} punto>{t.estado_nombre}</Insignia>
                {t.sla.estado === "vencido" || t.sla.estado === "en_riesgo" ? (
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11.5px] font-bold ${sla.fondo} ${sla.texto}`}>
                    <Timer className="h-3 w-3" aria-hidden /> SLA {sla.etiqueta.toLowerCase()}
                  </span>
                ) : null}
              </div>
            </div>
            {editando ? null : (
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => void recargar()} aria-label="Actualizar" title="Actualizar" className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:border-[#4FAEB2]/50 hover:text-[#2F6E71]">
                  <RefreshCw className="h-4 w-4" />
                </button>
                <Link href={`${base}/editar`} className={claseBoton("primario")}>
                  <Pencil className="h-4 w-4" aria-hidden /> Editar
                </Link>
                <div className="relative" ref={menuRef}>
                  <button type="button" onClick={() => setMenu((m) => !m)} aria-label="Acciones" aria-expanded={menu} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-[#4FAEB2]/50">
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  {menu ? (
                    <div className="absolute right-0 top-11 z-30 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 text-[13px] shadow-xl">
                      {[
                        { et: "Agregar comentario", ic: MessageSquare, href: `${base}#comentarios` },
                        { et: "Adjuntar archivos", ic: Paperclip, href: `${base}/archivos` },
                        { et: "Vincular ticket", ic: Link2, href: `${base}/relaciones` },
                        { et: "Copiar enlace", ic: Link2, onClick: () => void navigator.clipboard?.writeText(`${window.location.origin}${base}`) },
                      ].map((it) => {
                        const Ic = it.ic;
                        const cls = "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left font-medium text-slate-700 no-underline hover:bg-[#4FAEB2]/8 hover:text-[#2F6E71]";
                        return it.href ? (
                          <Link key={it.et} href={it.href} onClick={() => setMenu(false)} className={cls}><Ic className="h-4 w-4" aria-hidden />{it.et}</Link>
                        ) : (
                          <button key={it.et} type="button" onClick={() => { setMenu(false); it.onClick?.(); }} className={cls}><Ic className="h-4 w-4" aria-hidden />{it.et}</button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
          {editando ? null : <EstadoRapido />}
        </header>

        {editando ? (
          children
        ) : (
          <>
            <section className="mb-4 rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-[0_1px_3px_rgba(15,23,42,0.05)]">
              <div className="grid grid-cols-2 items-center gap-x-5 gap-y-3 sm:grid-cols-4 xl:grid-cols-7">
                <Dato
                  etiqueta="Cliente"
                  icono={Building2}
                  tono="turquesa"
                >
                  {t.cliente_id ? (
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Link href={`/clientes/${t.cliente_id}`} title={t.cliente_nombre ?? "Abrir la ficha del cliente"} className="truncate text-slate-800 no-underline hover:text-[#2F6E71] hover:underline">{t.cliente_nombre ?? "—"}</Link>
                      <Link
                        href={`/dashboard/soporte/tickets?cliente_id=${t.cliente_id}`}
                        title="Ver los tickets de este cliente"
                        aria-label="Ver los tickets de este cliente"
                        className="inline-flex shrink-0 items-center rounded-full bg-slate-100 p-1 text-slate-500 hover:bg-[#4FAEB2]/15 hover:text-[#2F6E71]"
                      >
                        <ListChecks className="h-3 w-3" aria-hidden />
                      </Link>
                      {t.origen === "tipificacion_cliente" ? (
                        <Link
                          href={`/clientes/${t.cliente_id}/tipificacion${t.tipificacion_id ? `#tip-${t.tipificacion_id}` : ""}`}
                          title="Creado desde la tipificación de cliente"
                          aria-label="Creado desde la tipificación de cliente"
                          className="inline-flex shrink-0 items-center rounded-full bg-[#4FAEB2]/12 p-1 text-[#2F6E71] hover:bg-[#4FAEB2]/25"
                        >
                          <Headset className="h-3 w-3" aria-hidden />
                        </Link>
                      ) : null}
                    </span>
                  ) : "—"}
                </Dato>
                <Dato etiqueta="Tipo" icono={Tag} tono="violeta">
                  {catalogos.tipos.find((x) => x.codigo === t.tipo_codigo)?.nombre ?? t.tipo_etiqueta}
                </Dato>
                <Dato etiqueta="Clasificación" icono={Layers} tono="ambar">
                  {t.clasificacion_nombre ?? <span className="font-medium text-slate-400">—</span>}
                </Dato>
                <Dato etiqueta="Creado" icono={CalendarPlus} tono="indigo">{fechaHora(t.created_at)}</Dato>
                <Dato etiqueta="Actualizado" icono={Clock3} tono="pizarra">{fechaHora(t.updated_at)}</Dato>
                <Dato etiqueta="Entrega" icono={CalendarCheck} tono="rosa">
                  {t.fecha_objetivo ? (
                    // Vencida y todavía abierta: en rojo, que es lo primero que hay que ver.
                    <span className={t.estado_tipo === "abierto" && Date.parse(t.fecha_objetivo) < ahora ? "text-rose-600" : "text-slate-800"}>
                      {fechaHora(t.fecha_objetivo)}
                    </span>
                  ) : (
                    <span className="font-medium text-slate-400">Sin fecha</span>
                  )}
                </Dato>
                <div
                  className={`min-w-0 rounded-lg px-2.5 py-1.5 ${sla.fondo}`}
                  title={t.fecha_objetivo ? `Objetivo: ${fechaHora(t.fecha_objetivo)}` : undefined}
                >
                  <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">
                    <Timer className={`h-3.5 w-3.5 shrink-0 ${sla.texto}`} strokeWidth={2.2} aria-hidden />
                    <span className="truncate">SLA {t.sla_horas == null ? "" : `${Number(t.sla_horas)} h laborales`}</span>
                  </p>
                  {t.sla_horas == null ? (
                    <p className="mt-0.5 text-[13px] font-semibold text-slate-400">Sin SLA</p>
                  ) : (
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className={`shrink-0 text-[13px] font-bold tabular-nums ${sla.texto}`}>
                        {duracionCorta(t.sla.transcurridoMs)}
                        {t.sla.objetivoMs ? <span className="text-[11px] font-semibold text-slate-400"> / {duracionCorta(t.sla.objetivoMs)}</span> : null}
                      </span>
                      {t.sla.objetivoMs ? (
                        <div className="h-1.5 min-w-6 flex-1 overflow-hidden rounded-full bg-white/80" title={sla.etiqueta}>
                          <div className={`h-full rounded-full ${sla.barra} transition-[width] duration-700`} style={{ width: `${Math.max(4, proporcion * 100)}%` }} />
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            </section>

            <div className="mb-5">
              <PestanasRuta
                activo={activo}
                items={[
                  { id: "descripcion", etiqueta: "Descripción", href: base, icono: FileText },
                  { id: "archivos", etiqueta: "Archivos", href: `${base}/archivos`, contador: detalle.contadores.archivos, icono: Paperclip },
                  { id: "historial", etiqueta: "Historial", href: `${base}/historial`, icono: History },
                  { id: "relaciones", etiqueta: "Relaciones", href: `${base}/relaciones`, contador: detalle.contadores.relaciones, icono: Link2 },
                ]}
              />
            </div>
            {children}
          </>
        )}

      </Pagina>
    </TicketContext.Provider>
  );
}
