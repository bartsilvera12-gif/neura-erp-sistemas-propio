"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  CalendarDays,
  Clock,
  Folder,
  Headset,
  Info,
  Link2,
  ListChecks,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Pencil,
  RefreshCw,
  Settings,
  Target,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { duracionCorta, numeroTicket } from "@/lib/soporte/dominio";
import {
  catalogosEnMemoria,
  fechaHora,
  obtenerCatalogos,
  obtenerTicket,
  precargarPestanas,
  ticketEnMemoria,
  type CatalogosConEquipo,
} from "../../_ui/api";
import { TicketContext, type TicketCtx, type TicketDetalle } from "../../_ui/TicketContexto";
import EstadoRapido from "../../_ui/EstadoRapido";
import AccesosProyecto from "../../_ui/AccesosProyecto";
import { Aviso, Esqueleto, Pagina, claseBoton } from "../../_ui/ui";

type Detalle = { ticket: TicketDetalle; contadores: TicketCtx["contadores"] };

const TARJETA =
  "rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.05),0_8px_24px_-12px_rgba(15,23,42,0.08)]";

/**
 * Color de la clasificación: lo urgente en naranja, lo medio en ámbar, lo bajo
 * en celeste y los cambios en violeta. Sale del nombre porque cada empresa
 * nombra sus niveles a su manera.
 */
function tonoClasificacion(nombre: string | null | undefined): { texto: string; fondo: string; circulo: string } {
  const n = (nombre ?? "").toLowerCase();
  if (/alto|urgente|cr[ií]tic/.test(n)) return { texto: "text-orange-600", fondo: "bg-orange-50 text-orange-600", circulo: "bg-orange-100 text-orange-600" };
  if (/medio/.test(n)) return { texto: "text-amber-600", fondo: "bg-amber-50 text-amber-700", circulo: "bg-amber-100 text-amber-600" };
  if (/bajo/.test(n)) return { texto: "text-sky-600", fondo: "bg-sky-50 text-sky-700", circulo: "bg-sky-100 text-sky-600" };
  if (/cambio|est[eé]tic|funcional/.test(n)) return { texto: "text-violet-600", fondo: "bg-violet-50 text-violet-700", circulo: "bg-violet-100 text-violet-600" };
  return { texto: "text-slate-700", fondo: "bg-slate-100 text-slate-600", circulo: "bg-slate-100 text-slate-500" };
}

/** Un dato de la franja de resumen: ícono (o un adorno propio), etiqueta chica y valor. */
function Resumen({
  icono: Icono,
  adorno,
  etiqueta,
  children,
}: {
  icono?: LucideIcon;
  adorno?: React.ReactNode;
  etiqueta: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-slate-400">
        {adorno ?? (Icono ? <Icono className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden /> : null)}
        {etiqueta}
      </p>
      <div className="mt-1 line-clamp-2 break-words text-[14px] font-bold leading-snug text-slate-800">{children}</div>
    </div>
  );
}

/** Fila de "Información clave". */
function Clave({ icono: Icono, etiqueta, children }: { icono: LucideIcon; etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[14px_104px_minmax(0,1fr)] items-start gap-x-2.5 py-2">
      <Icono className="mt-[3px] h-3.5 w-3.5 text-slate-400" strokeWidth={2} aria-hidden />
      <span className="text-[12.5px] leading-5 text-slate-500">{etiqueta}</span>
      <div className="min-w-0 break-words text-[13px] font-medium leading-5 text-slate-800">{children}</div>
    </div>
  );
}

/**
 * Subtítulo del encabezado: lo que dice la descripción después del asunto. El
 * asunto es la primera línea de la descripción, así que se salta para no
 * repetirlo.
 */
function subtituloDe(asunto: string, descripcion: string | null | undefined): string {
  const lineas = (descripcion ?? "").split(/\r?\n/).map((l) => l.replace(/^[\s*#>\-•]+/, "").trim()).filter(Boolean);
  const a = asunto.trim().toLowerCase();
  const resto = lineas.filter((l, i) => !(i === 0 && (l.toLowerCase().startsWith(a) || a.startsWith(l.toLowerCase()))));
  const texto = resto.join(" ");
  return texto.length > 180 ? `${texto.slice(0, 177).trimEnd()}…` : texto;
}

/**
 * Marco del detalle de un ticket: encabezado, resumen, estado, pestañas y la
 * columna de información clave.
 *
 * Es un LAYOUT: cada pestaña es una ruta real (/archivos, /historial, …) que
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
  // Momento de la carga, para calcular cuánto falta para la entrega sin leer el reloj en cada render.
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

  // Las pestañas se preparan apenas se abre el ticket: cambiar de pestaña no espera.
  useEffect(() => {
    precargarPestanas(id);
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
        <Esqueleto className="mb-2 h-9 w-2/3" />
        <Esqueleto className="mb-5 h-5 w-1/2" />
        <Esqueleto className="mb-5 h-20 w-full rounded-2xl" />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
          <Esqueleto className="h-96 w-full rounded-2xl" />
          <Esqueleto className="h-72 w-full rounded-2xl" />
        </div>
      </Pagina>
    );
  }

  const t = detalle.ticket;
  const base = `/dashboard/soporte/tickets/${t.id}`;
  const editando = pathname.endsWith("/editar");
  const activo = (["archivos", "historial", "relaciones"] as const).find((x) => pathname.endsWith(`/${x}`)) ?? "descripcion";
  const ctx: TicketCtx = { ticket: t, contadores: detalle.contadores, catalogos, recargar };
  const tipoNombre = catalogos.tipos.find((x) => x.codigo === t.tipo_codigo)?.nombre ?? t.tipo_etiqueta;
  const clasif = tonoClasificacion(t.clasificacion_nombre);
  const subtitulo = subtituloDe(t.asunto, t.descripcion);

  // Cuánto falta para la entrega (o cuánto hace que venció, si sigue abierto).
  const entregaMs = t.fecha_objetivo ? Date.parse(t.fecha_objetivo) - ahora : null;
  const abierto = t.estado_tipo === "abierto";
  const entregaRel =
    entregaMs == null || !abierto
      ? null
      : entregaMs >= 0
        ? { texto: `en ${duracionCorta(entregaMs)}`, clase: entregaMs < 24 * 3600_000 ? "text-orange-500" : "text-slate-400" }
        : { texto: `vencida hace ${duracionCorta(-entregaMs)}`, clase: "text-rose-600" };

  const pestanas = [
    { id: "descripcion", etiqueta: "Descripción", href: base, contador: null as number | null },
    { id: "archivos", etiqueta: "Archivos", href: `${base}/archivos`, contador: detalle.contadores.archivos },
    { id: "historial", etiqueta: "Historial", href: `${base}/historial`, contador: null },
    { id: "relaciones", etiqueta: "Relaciones", href: `${base}/relaciones`, contador: detalle.contadores.relaciones },
  ];

  const menuItems = [
    { et: "Actualizar", ic: RefreshCw, onClick: () => void recargar() },
    { et: "Agregar comentario", ic: MessageSquare, href: `${base}#comentarios` },
    { et: "Adjuntar archivos", ic: Paperclip, href: `${base}/archivos` },
    { et: "Vincular ticket", ic: Link2, href: `${base}/relaciones` },
    { et: "Ver tickets del cliente", ic: ListChecks, href: t.cliente_id ? `/dashboard/soporte/tickets?cliente_id=${t.cliente_id}` : undefined },
    { et: "Copiar enlace", ic: Link2, onClick: () => void navigator.clipboard?.writeText(`${window.location.origin}${base}`) },
  ].filter((it) => it.href !== undefined || it.onClick);

  return (
    <TicketContext.Provider value={ctx}>
      <Pagina>
        <nav className="mb-3 flex items-center gap-2 text-[13.5px] text-slate-400" aria-label="Ruta">
          <Link href="/dashboard/soporte/tickets" className="font-medium text-slate-500 no-underline hover:text-[#2F6E71]">Tickets</Link>
          <span aria-hidden>/</span>
          <Link href={base} className="font-semibold text-slate-700 no-underline hover:text-[#2F6E71]">{numeroTicket(t.numero)}</Link>
          {editando ? (<><span aria-hidden>/</span><span>Editar</span></>) : null}
        </nav>

        <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-4xl">
            <h1 className="text-[26px] font-bold leading-tight tracking-tight text-slate-900 md:text-[30px]">{t.asunto}</h1>
            {subtitulo ? <p className="mt-2 line-clamp-2 text-[15px] leading-relaxed text-slate-500">{subtitulo}</p> : null}
          </div>
          {editando ? null : (
            <div className="flex shrink-0 items-center gap-2.5">
              <Link
                href={`${base}/editar`}
                className="inline-flex items-center gap-2 rounded-xl bg-[#1F8F7A] px-5 py-2.5 text-[14.5px] font-semibold text-white no-underline shadow-[0_8px_18px_-8px_rgba(31,143,122,0.8)] transition hover:bg-[#197866]"
              >
                <Pencil className="h-4 w-4" aria-hidden /> Editar
              </Link>
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setMenu((m) => !m)}
                  aria-label="Más acciones"
                  aria-expanded={menu}
                  className="grid h-[42px] w-[46px] place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-[#4FAEB2]/50"
                >
                  <MoreHorizontal className="h-5 w-5" />
                </button>
                {menu ? (
                  <div className="absolute right-0 top-12 z-30 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 text-[13px] shadow-xl">
                    {menuItems.map((it) => {
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
        </header>

        {editando ? (
          children
        ) : (
          <>
            {/* Franja de resumen. */}
            <section className={`${TARJETA} mb-5 grid grid-cols-1 divide-y divide-slate-100 p-2 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-3 xl:grid-cols-[1.35fr_1.35fr_0.8fr_1fr_1fr_0.85fr] xl:divide-x`}>
              <div className="min-w-0 rounded-xl bg-[#4FAEB2]/10 px-4 py-3">
                <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-[#3F8E91]">
                  <Folder className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                  Proyecto
                </p>
                {t.proyecto_id ? (
                  <Link
                    href={`/dashboard/proyectos/${t.proyecto_id}`}
                    title={t.proyecto_titulo ?? undefined}
                    className="mt-1 line-clamp-2 break-words text-[14px] font-bold leading-snug text-[#2F8F8F] no-underline hover:underline"
                  >
                    {t.proyecto_titulo ?? "Ver proyecto"}
                  </Link>
                ) : (
                  <p className="mt-1 text-[14px] font-semibold text-slate-400">Sin proyecto</p>
                )}
              </div>
              <Resumen icono={UserRound} etiqueta="Cliente">
                {t.cliente_id ? (
                  <span className="inline">
                    <Link href={`/clientes/${t.cliente_id}`} title={t.cliente_nombre ?? "Abrir la ficha del cliente"} className="text-slate-800 no-underline hover:text-[#2F6E71] hover:underline">
                      {t.cliente_nombre ?? "—"}
                    </Link>
                    {t.origen === "tipificacion_cliente" ? (
                      <Link
                        href={`/clientes/${t.cliente_id}/tipificacion${t.tipificacion_id ? `#tip-${t.tipificacion_id}` : ""}`}
                        title="Creado desde la tipificación de cliente"
                        aria-label="Creado desde la tipificación de cliente"
                        className="ml-1.5 inline-flex translate-y-[1px] items-center rounded-full bg-[#4FAEB2]/12 p-[3px] align-baseline text-[#2F6E71] hover:bg-[#4FAEB2]/25"
                      >
                        <Headset className="h-2.5 w-2.5" aria-hidden />
                      </Link>
                    ) : null}
                  </span>
                ) : (
                  "—"
                )}
              </Resumen>
              <Resumen icono={Settings} etiqueta="Tipo">{tipoNombre}</Resumen>
              <Resumen
                adorno={
                  <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full ${clasif.circulo}`}>
                    <ArrowUp className="h-3 w-3" strokeWidth={2.6} aria-hidden />
                  </span>
                }
                etiqueta="Clasificación"
              >
                <span className={clasif.texto}>{t.clasificacion_nombre ?? "—"}</span>
              </Resumen>
              <Resumen icono={UserRound} etiqueta="Responsable">{t.responsable?.nombre ?? <span className="text-slate-400">Sin asignar</span>}</Resumen>
              <Resumen icono={Clock} etiqueta="SLA">
                {t.sla_horas == null ? <span className="text-slate-400">Sin SLA</span> : `${Number(t.sla_horas)} h laborales`}
              </Resumen>
            </section>

            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
              {/* Estado, pestañas y contenido. */}
              <div className={`${TARJETA} min-w-0 p-5`}>
                <EstadoRapido />
                <nav className="mt-5 flex gap-1 overflow-x-auto border-b border-slate-100" aria-label="Secciones">
                  {pestanas.map((p) => {
                    const sel = p.id === activo;
                    return (
                      <Link
                        key={p.id}
                        href={p.href}
                        scroll={false}
                        aria-current={sel ? "page" : undefined}
                        className={`-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-2.5 text-[14px] no-underline transition ${
                          sel ? "border-[#1F8F7A] font-semibold text-[#1F8F7A]" : "border-transparent font-medium text-slate-500 hover:text-slate-800"
                        }`}
                      >
                        {p.etiqueta}
                        {p.contador ? <span className="rounded-full bg-slate-100 px-1.5 text-[11px] font-bold tabular-nums text-slate-500">{p.contador}</span> : null}
                      </Link>
                    );
                  })}
                </nav>
                <div className="pt-5">{children}</div>
              </div>

              <aside className="min-w-0 space-y-5">
                <section className={`${TARJETA} px-5 py-4`}>
                  <h2 className="mb-1 flex items-center gap-1.5 text-[14.5px] font-bold text-slate-800">
                    Información clave
                    <Info className="h-3 w-3 text-slate-300" aria-hidden />
                  </h2>
                  <Clave icono={Folder} etiqueta="Proyecto">
                    {t.proyecto_id ? (
                      <Link href={`/dashboard/proyectos/${t.proyecto_id}`} className="inline-block max-w-full rounded-md bg-[#4FAEB2]/12 px-2 py-0.5 font-semibold text-[#2F8F8F] no-underline hover:bg-[#4FAEB2]/20">
                        {t.proyecto_titulo ?? "Ver proyecto"}
                      </Link>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </Clave>
                  <Clave icono={UserRound} etiqueta="Cliente">
                    {t.cliente_id ? (
                      <Link href={`/clientes/${t.cliente_id}`} className="text-slate-800 no-underline hover:text-[#2F6E71] hover:underline">{t.cliente_nombre ?? "—"}</Link>
                    ) : (
                      "—"
                    )}
                  </Clave>
                  <Clave icono={UserRound} etiqueta="Responsable">
                    {t.responsable?.nombre ?? <span className="text-slate-400">Sin asignar</span>}
                  </Clave>
                  <Clave icono={ArrowUp} etiqueta="Clasificación">
                    {t.clasificacion_nombre ? (
                      <span className={`inline-block max-w-full rounded-md px-2 py-0.5 font-semibold ${clasif.fondo}`}>{t.clasificacion_nombre}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </Clave>
                  <Clave icono={Settings} etiqueta="Tipo">
                    <span className="inline-block rounded-md bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">{tipoNombre}</span>
                  </Clave>

                  <div className="my-1.5 border-t border-slate-100" />

                  <Clave icono={CalendarDays} etiqueta="Creado">{fechaHora(t.created_at)}</Clave>
                  <Clave icono={CalendarDays} etiqueta="Actualizado">{fechaHora(t.updated_at)}</Clave>
                  <Clave icono={Target} etiqueta="Entrega estimada">
                    {t.fecha_objetivo ? (
                      <>
                        <span className="block">{fechaHora(t.fecha_objetivo)}</span>
                        {entregaRel ? <span className={`block text-[12px] font-semibold ${entregaRel.clase}`}>{entregaRel.texto}</span> : null}
                      </>
                    ) : (
                      <span className="text-slate-400">Sin fecha</span>
                    )}
                  </Clave>
                  {t.creador?.nombre ? <Clave icono={UserRound} etiqueta="Cargado por">{t.creador.nombre}</Clave> : null}
                </section>

                {t.proyecto_id ? (
                  <section className={`${TARJETA} p-4`}>
                    {/* En vivo desde el proyecto, con el permiso de Proyectos: el ticket no guarda credenciales. */}
                    <AccesosProyecto proyectoId={t.proyecto_id} compacto />
                  </section>
                ) : null}
              </aside>
            </div>
          </>
        )}
      </Pagina>
    </TicketContext.Provider>
  );
}
