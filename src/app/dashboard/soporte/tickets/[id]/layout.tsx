"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { MoreHorizontal, Pencil } from "lucide-react";
import { duracionCorta } from "@/lib/soporte/dominio";
import { apiSoporte, fecha, fechaHora, obtenerCatalogos, type CatalogosConEquipo } from "../../_ui/api";
import { TicketContext, type TicketCtx, type TicketDetalle } from "../../_ui/TicketContexto";
import CambiarEstado from "../../_ui/CambiarEstado";
import { Aviso, Avatar, Cargando, Insignia, Pagina, PestanasRuta, claseBoton } from "../../_ui/ui";

const COLOR_SLA: Record<string, { barra: string; texto: string; etiqueta: string }> = {
  en_tiempo: { barra: "bg-emerald-500", texto: "text-emerald-700", etiqueta: "En tiempo" },
  en_riesgo: { barra: "bg-amber-500", texto: "text-amber-700", etiqueta: "En riesgo" },
  vencido: { barra: "bg-rose-500", texto: "text-rose-700", etiqueta: "Vencido" },
  cumplido: { barra: "bg-emerald-500", texto: "text-emerald-700", etiqueta: "Cumplido" },
  incumplido: { barra: "bg-rose-500", texto: "text-rose-700", etiqueta: "Incumplido" },
  sin_sla: { barra: "bg-slate-300", texto: "text-slate-500", etiqueta: "Sin SLA" },
};

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11.5px] text-slate-500">{etiqueta}</p>
      <div className="mt-1 truncate text-[13px] font-medium text-slate-800">{children}</div>
    </div>
  );
}

/**
 * Marco del detalle de un ticket: encabezado, resumen y pestañas.
 *
 * Es un LAYOUT y no un componente con pestañas: cada pestaña es una ruta real
 * (/comentarios, /archivos, …) que se puede recargar, compartir o abrir en otra
 * pestaña del navegador. Como el layout persiste entre esas rutas, el ticket se
 * pide una vez y se comparte por contexto; las subpáginas llaman a `recargar()`
 * cuando cambian algo que el encabezado muestra.
 */
export default function TicketLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const [ctx, setCtx] = useState<Omit<TicketCtx, "recargar"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [cambiando, setCambiando] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const recargar = useCallback(async () => {
    try {
      const [detalle, catalogos] = await Promise.all([
        apiSoporte<{ ticket: TicketDetalle; contadores: TicketCtx["contadores"] }>(`/api/soporte/tickets/${id}`),
        obtenerCatalogos(),
      ]);
      setCtx({ ticket: detalle.ticket, contadores: detalle.contadores, catalogos: catalogos as CatalogosConEquipo });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el ticket");
    }
  }, [id]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  useEffect(() => {
    if (!menu) return;
    const cerrar = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", cerrar);
    return () => document.removeEventListener("mousedown", cerrar);
  }, [menu]);

  if (error && !ctx) {
    return (
      <Pagina>
        <Aviso>{error}</Aviso>
        <Link href="/dashboard/soporte/tickets" className={`${claseBoton("secundario")} mt-4`}>
          Volver a Tickets
        </Link>
      </Pagina>
    );
  }
  if (!ctx) return <Cargando />;

  const t = ctx.ticket;
  const base = `/dashboard/soporte/tickets/${t.id}`;
  const editando = pathname.endsWith("/editar");
  const sla = COLOR_SLA[t.sla.estado] ?? COLOR_SLA.sin_sla;
  const proporcion = t.sla.proporcion == null ? 0 : Math.min(1, t.sla.proporcion);

  const activo = pathname.endsWith("/comentarios")
    ? "comentarios"
    : pathname.endsWith("/archivos")
      ? "archivos"
      : pathname.endsWith("/historial")
        ? "historial"
        : pathname.endsWith("/relaciones")
          ? "relaciones"
          : "descripcion";

  return (
    <TicketContext.Provider value={{ ...ctx, recargar }}>
      <Pagina>
        <nav className="mb-2 flex items-center gap-1.5 text-[12px] text-slate-400" aria-label="Ruta">
          <Link href="/dashboard/soporte/tickets" className="text-[#2F6E71] no-underline hover:underline">
            Tickets
          </Link>
          <span aria-hidden>›</span>
          <Link href={base} className="text-slate-500 no-underline hover:underline">#{t.numero}</Link>
          {editando ? (
            <>
              <span aria-hidden>›</span>
              <span>Editar</span>
            </>
          ) : null}
        </nav>

        <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">
              <span className="text-slate-400">#{t.numero}</span> · {t.asunto}
            </h1>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Insignia color={t.estado_color} punto>{t.estado_nombre}</Insignia>
              <Insignia color={t.prioridad_color}>{t.prioridad_nombre}</Insignia>
            </div>
          </div>
          {editando ? null : (
            <div className="flex items-center gap-2">
              <Link href={`${base}/editar`} className={claseBoton("primario")}>
                <Pencil className="h-4 w-4" aria-hidden /> Editar
              </Link>
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setMenu((m) => !m)}
                  aria-label="Acciones"
                  aria-expanded={menu}
                  className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {menu ? (
                  <div className="absolute right-0 top-11 z-30 w-52 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-[13px] shadow-lg">
                    <button type="button" onClick={() => { setMenu(false); setCambiando(true); }} className="block w-full px-3 py-2 text-left text-slate-700 hover:bg-slate-50">
                      Cambiar estado
                    </button>
                    <Link href={`${base}/comentarios`} onClick={() => setMenu(false)} className="block px-3 py-2 text-slate-700 no-underline hover:bg-slate-50">
                      Agregar comentario
                    </Link>
                    <Link href={`${base}/archivos`} onClick={() => setMenu(false)} className="block px-3 py-2 text-slate-700 no-underline hover:bg-slate-50">
                      Adjuntar archivos
                    </Link>
                    <Link href={`${base}/relaciones`} onClick={() => setMenu(false)} className="block px-3 py-2 text-slate-700 no-underline hover:bg-slate-50">
                      Vincular ticket
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        setMenu(false);
                        void navigator.clipboard?.writeText(`${window.location.origin}${base}`);
                      }}
                      className="block w-full px-3 py-2 text-left text-slate-700 hover:bg-slate-50"
                    >
                      Copiar enlace
                    </button>
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
            <section className="mb-5 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
                <Dato etiqueta="Cliente">
                  {t.cliente_id ? (
                    <Link href={`/dashboard/soporte/tickets?cliente_id=${t.cliente_id}`} className="text-slate-800 no-underline hover:text-[#2F6E71]">
                      {t.cliente_nombre ?? "—"}
                    </Link>
                  ) : "—"}
                </Dato>
                <Dato etiqueta="Tipo">{t.tipo_etiqueta}{t.clasificacion_nombre && t.tipo_codigo === "error" ? ` · ${t.clasificacion_nombre}` : ""}</Dato>
                <Dato etiqueta="Prioridad">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.prioridad_color }} aria-hidden />
                    {t.prioridad_nombre}
                  </span>
                </Dato>
                <Dato etiqueta="Asignado a">
                  {t.responsable ? (
                    <span className="inline-flex items-center gap-2">
                      <Avatar nombre={t.responsable.nombre} tam={20} />
                      {t.responsable.nombre}
                    </span>
                  ) : (
                    <span className="text-slate-400">Sin asignar</span>
                  )}
                </Dato>
                <Dato etiqueta="Creado">{fechaHora(t.created_at)}</Dato>
                <Dato etiqueta="Última actualización">{fechaHora(t.updated_at)}</Dato>
                <Dato etiqueta="SLA">
                  {t.sla_horas == null ? <span className="text-slate-400">Sin SLA</span> : `${Number(t.sla_horas)} horas`}
                  {t.fecha_objetivo ? <span className="ml-1.5 text-[12px] font-normal text-slate-400">· objetivo {fecha(t.fecha_objetivo)}</span> : null}
                </Dato>
                <Dato etiqueta="Tiempo transcurrido">
                  <span className={sla.texto}>
                    {duracionCorta(t.sla.transcurridoMs)}
                    {t.sla.objetivoMs ? <span className="font-normal text-slate-400"> de {duracionCorta(t.sla.objetivoMs)}</span> : null}
                  </span>
                  {t.sla.objetivoMs ? (
                    <div className="mt-1.5 flex items-center gap-2" title={sla.etiqueta}>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className={`h-full rounded-full ${sla.barra}`} style={{ width: `${Math.max(3, proporcion * 100)}%` }} />
                      </div>
                      <span className={`text-[11px] font-medium ${sla.texto}`}>{sla.etiqueta}</span>
                    </div>
                  ) : null}
                </Dato>
              </div>
            </section>

            <div className="mb-5">
              <PestanasRuta
                activo={activo}
                items={[
                  { id: "descripcion", etiqueta: "Descripción", href: base },
                  { id: "comentarios", etiqueta: "Comentarios", href: `${base}/comentarios`, contador: ctx.contadores.comentarios },
                  { id: "archivos", etiqueta: "Archivos", href: `${base}/archivos`, contador: ctx.contadores.archivos },
                  { id: "historial", etiqueta: "Historial", href: `${base}/historial` },
                  { id: "relaciones", etiqueta: "Relaciones", href: `${base}/relaciones`, contador: ctx.contadores.relaciones },
                ]}
              />
            </div>
            {children}
          </>
        )}

        {cambiando ? <CambiarEstado alCerrar={() => setCambiando(false)} /> : null}
      </Pagina>
    </TicketContext.Provider>
  );
}
