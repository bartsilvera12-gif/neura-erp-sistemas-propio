"use client";

import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlarmClock, CalendarDays, Filter, UserRoundCheck, ChevronDown, ChevronLeft, ChevronRight, Inbox, Search, SlidersHorizontal, UserPen, X } from "lucide-react";
import { FancySelect } from "@/app/dashboard/proyectos/components/FancySelect";
import {
  apiSoporte,
  catalogosEnMemoria,
  clientesEnMemoria,
  fechaHora,
  obtenerCatalogos,
  obtenerClientes,
  precargarTicket,
  type CatalogosConEquipo,
  type Persona,
} from "./api";
import { Aviso, Avatar, Cargando, Fase, Insignia, TONOS, TONO_AREA, TONO_ESTADO, Vacio, claseInput, type Tono } from "./ui";
import { SelectorBuscable } from "./SelectorBuscable";
import { numeroTicket } from "@/lib/soporte/dominio";

export type PestanaDef = {
  id: string;
  etiqueta: string;
  estados: readonly string[] | null;
  /** Tickets con una revisión de QA sin terminar asignada a quien mira. */
  revision?: boolean;
};

/**
 * Día de hoy / ayer en formato YYYY-MM-DD, en hora LOCAL.
 *
 * `toISOString()` devuelve UTC: en Paraguay, después de las 21:00 daba el día siguiente y
 * "Hoy" filtraba por mañana.
 */
function diaISO(desplazamiento = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + desplazamiento);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const hoyISO = () => diaISO(0);
const ayerISO = () => diaISO(-1);

type TicketLista = {
  id: string;
  numero: number;
  asunto: string;
  /** Ya la devuelve /api/soporte/tickets (TICKET_CAMPOS): la usa el panel desplegable. */
  descripcion?: string | null;
  cliente_nombre: string | null;
  proyectos_cliente: { id: string; titulo: string }[];
  tipo_etiqueta: string;
  estado_codigo: string;
  fase?: number;
  estado_nombre: string;
  estado_color: string;
  tipo_codigo: string;
  clasificacion_nombre: string | null;
  origen_subestado: string | null;
  responsable: Persona | null;
  creador: Persona | null;
  updated_at: string;
  created_at: string;
  sla: { estado: string };
};

type RespLista = {
  tickets: TicketLista[];
  total: number;
  pagina: number;
  por_pagina: number;
  por_estado: Record<string, number>;
  /** Sólo en "Mis tickets": revisiones de QA pendientes asignadas a quien mira. */
  revisiones_pendientes?: number;
};

const POR_PAGINA = 20;
const OPCIONES_POR_PAGINA = [20, 50, 100] as const;

/**
 * El último resultado de cada consulta. Volver al listado desde un ticket lo
 * pinta al instante con lo que había y lo refresca en silencio, en vez de
 * mostrar un esqueleto cada vez.
 */
const recordado = new Map<string, RespLista>();

function tonoPestana(p: PestanaDef): Tono {
  if (p.revision) return "violeta";
  if (!p.estados) return "turquesa";
  // El primero de la lista es el estado que da nombre a la pestaña: "En proceso" se pinta como
  // En proceso, no como Re-abierto, que es el que iba último.
  return TONO_ESTADO[p.estados[0]] ?? "turquesa";
}

/**
 * Listado de tickets con pestañas, filtros y paginación.
 *
 * El estado vive en la URL (?pestana=…&cliente_id=…): un refresh no pierde los
 * filtros, "atrás" funciona, y otras pantallas enlazan listados ya filtrados.
 */
export default function TablaTickets({
  pestanas,
  soloMios = false,
  ocultarResponsable = false,
  abrirPestanaConDatos = false,
}: {
  pestanas: readonly PestanaDef[];
  soloMios?: boolean;
  ocultarResponsable?: boolean;
  /**
   * Si se entra sin elegir pestaña y la primera está vacía, se abre la primera
   * que tenga tickets (p. ej. QA entra a "Mis tickets" y va directo a "Por revisar").
   */
  abrirPestanaConDatos?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const pestana = pestanas.find((p) => p.id === params.get("pestana")) ?? pestanas[0];
  const filtros = {
    q: params.get("q") ?? "",
    cliente_id: params.get("cliente_id") ?? "",
    estado: params.get("estado") ?? "",
    tipo: params.get("tipo") ?? "",
    responsable_id: params.get("responsable_id") ?? "",
    cargados: params.get("cargados") ?? "",
    desde: params.get("desde") ?? "",
    hasta: params.get("hasta") ?? "",
  };
  const soloCargados = filtros.cargados === "1";
  /**
   * Orden de la lista. Va aparte de `filtros` a propósito: ordenar no es filtrar, y si
   * entrara ahí contaría como "filtro activo" y encendería el botón de limpiar.
   */
  const orden = params.get("orden") ?? "";
  /**
   * "Mis tickets" dejó de ser una pantalla aparte y pasó a ser un botón de esta barra.
   * La pantalla vieja sigue existiendo (hay enlaces que apuntan ahí) y entra por `soloMios`;
   * acá se enciende por URL.
   */
  const soloMiosEfectivo = soloMios || params.get("mios") === "1";
  /**
   * Columnas elegidas, guardadas en el navegador.
   *
   * Es una preferencia de quien mira, no un dato del ticket: no tiene por qué viajar en la
   * URL ni guardarse en la base. Se lee una vez al montar; si el navegador no deja (modo
   * privado), se usa el orden de siempre y no se rompe nada.
   */
  const CLAVE_COLUMNAS = "soporte:tickets:columnas";
  const [colOrden, setColOrden] = useState<string[]>([]);
  const [colOcultas, setColOcultas] = useState<string[]>([]);
  const [embudoAbierto, setEmbudoAbierto] = useState(false);
  useEffect(() => {
    try {
      const crudo = localStorage.getItem(CLAVE_COLUMNAS);
      if (!crudo) return;
      const guardado = JSON.parse(crudo) as { orden?: string[]; ocultas?: string[] };
      if (Array.isArray(guardado.orden)) setColOrden(guardado.orden);
      if (Array.isArray(guardado.ocultas)) setColOcultas(guardado.ocultas);
    } catch {
      /* sin storage o guardado roto: el orden de siempre */
    }
  }, []);
  const guardarColumnas = useCallback((orden: string[], ocultas: string[]) => {
    setColOrden(orden);
    setColOcultas(ocultas);
    try {
      localStorage.setItem(CLAVE_COLUMNAS, JSON.stringify({ orden, ocultas }));
    } catch {
      /* no poder recordarlo no es motivo para no aplicarlo ahora */
    }
  }, []);

  const [buscadorAbierto, setBuscadorAbierto] = useState(false);
  const [panelAbierto, setPanelAbierto] = useState(false);
  /** Cuántos filtros hay puestos, para el número del botón. El texto se ve solo. */
  const filtrosPuestos = [
    filtros.cliente_id, filtros.estado, filtros.tipo, filtros.responsable_id,
    filtros.cargados, filtros.desde, filtros.hasta,
  ].filter(Boolean).length;
  const pagina = Math.max(1, Number(params.get("pagina") ?? "1") || 1);
  const porPagina = (OPCIONES_POR_PAGINA as readonly number[]).includes(Number(params.get("por_pagina")))
    ? Number(params.get("por_pagina"))
    : POR_PAGINA;

  const consulta = useMemo(() => {
    const q = new URLSearchParams();
    if (pestana.estados) q.set("estados", pestana.estados.join(","));
    if (pestana.revision) q.set("revision", "1");
    for (const [k, v] of Object.entries(filtros)) if (v) q.set(k, v);
    if (soloMiosEfectivo) q.set("mios", "1");
    if (orden) q.set("orden", orden);
    q.set("pagina", String(pagina));
    q.set("por_pagina", String(porPagina));
    return q.toString();
    // `params` resume todos los filtros de la URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, soloMiosEfectivo, pestana]);

  // Auto-scroll horizontal: cuando el cursor se acerca a un borde de la tabla,
  // se desplaza sola hacia ese lado (más rápido cuanto más cerca del borde).
  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const velRef = useRef(0);
  const pararAutoScroll = useCallback(() => {
    velRef.current = 0;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);
  const autoScrollBorde = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) {
      velRef.current = 0;
      return;
    }
    const rect = el.getBoundingClientRect();
    const margen = 90; // zona de borde donde arranca el desplazamiento
    const maxVel = 22; // píxeles por cuadro en el borde mismo
    const x = e.clientX;
    const dDer = rect.right - x;
    const dIzq = x - rect.left;
    let vel = 0;
    if (dDer < margen) vel = Math.ceil(((margen - dDer) / margen) * maxVel);
    else if (dIzq < margen) vel = -Math.ceil(((margen - dIzq) / margen) * maxVel);
    velRef.current = vel;
    if (vel !== 0 && rafRef.current == null) {
      const paso = () => {
        const n = scrollRef.current;
        if (n && velRef.current !== 0) {
          n.scrollLeft += velRef.current;
          rafRef.current = requestAnimationFrame(paso);
        } else {
          rafRef.current = null;
        }
      };
      rafRef.current = requestAnimationFrame(paso);
    }
  }, []);
  useEffect(() => pararAutoScroll, [pararAutoScroll]);

  const [cat, setCat] = useState<CatalogosConEquipo | null>(() => catalogosEnMemoria() ?? null);
  const [clientes, setClientes] = useState<{ id: string; nombre: string }[]>(() => clientesEnMemoria() ?? []);
  const [datos, setDatos] = useState<RespLista | null>(() => recordado.get(consulta) ?? null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [texto, setTexto] = useState(filtros.q);

  // Autoasignarse: Desarrollo y QA toman un ticket desde la fila, sin abrirlo.
  const yo = cat?.personas.find((p) => p.id === cat.usuario_id);
  const puedoTomar = Boolean(yo && (yo.es_tecnico || yo.es_qa));
  const [tomando, setTomando] = useState<string | null>(null);
  const tomar = async (ticketId: string) => {
    if (!yo) return;
    setTomando(ticketId);
    setError(null);
    try {
      await apiSoporte(`/api/soporte/tickets/${ticketId}`, { method: "PATCH", json: { responsable_id: yo.id } });
      setDatos((d) => (d ? { ...d, tickets: d.tickets.map((x) => (x.id === ticketId ? { ...x, responsable: yo } : x)) } : d));
      recordado.clear();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo asignar el ticket");
    } finally {
      setTomando(null);
    }
  };

  useEffect(() => {
    void obtenerCatalogos().then(setCat).catch((e: Error) => setError(e.message));
    void obtenerClientes().then(setClientes).catch(() => {});
  }, []);

  useEffect(() => {
    let vivo = true;
    const guardado = recordado.get(consulta);
    if (guardado) setDatos(guardado);
    setCargando(true);
    apiSoporte<RespLista>(`/api/soporte/tickets?${consulta}`)
      .then((r) => {
        recordado.set(consulta, r);
        if (vivo) {
          setDatos(r);
          setError(null);
        }
      })
      .catch((e: Error) => vivo && setError(e.message))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [consulta]);

  const cambiar = useCallback(
    (cambios: Record<string, string | null>) => {
      const q = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(cambios)) {
        if (v) q.set(k, v);
        else q.delete(k);
      }
      if (!("pagina" in cambios)) q.delete("pagina");
      router.replace(`${pathname}?${q.toString()}`, { scroll: false });
    },
    [params, pathname, router]
  );

  useEffect(() => {
    if (texto === filtros.q) return;
    const t = window.setTimeout(() => cambiar({ q: texto.trim() || null }), 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  const contador = (p: PestanaDef) => {
    const pe = datos?.por_estado ?? {};
    if (p.revision) return datos?.revisiones_pendientes ?? 0;
    if (!p.estados) return Object.values(pe).reduce((s, n) => s + n, 0);
    return p.estados.reduce((s, e) => s + (pe[e] ?? 0), 0);
  };

  const pestanaElegida = params.has("pestana");
  useEffect(() => {
    if (!abrirPestanaConDatos || pestanaElegida || !datos) return;
    if (contador(pestana) > 0) return;
    const conDatos = pestanas.find((p) => contador(p) > 0);
    if (conDatos && conDatos.id !== pestana.id) cambiar({ pestana: conDatos.id });
    // `contador` sale de `datos`: alcanza con reaccionar a los datos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrirPestanaConDatos, pestanaElegida, datos]);

  const op = useMemo(() => {
    const todos = (etq: string) => [{ value: "", label: etq }];
    return {
      estado: [...todos("Todos los estados"), ...(cat?.estados ?? []).filter((e) => e.activo).map((e) => ({ value: e.codigo, label: e.nombre }))],
      tipo: [...todos("Todos los tipos"), ...(cat?.tipos ?? []).filter((t) => t.activo).map((t) => ({ value: t.codigo, label: t.nombre }))],
      responsable: [...todos("Cualquier responsable"), ...(cat?.personas ?? []).map((u) => ({ value: u.id, label: u.nombre, detalle: u.area, tono: TONO_AREA[u.area] }))],
    };
  }, [cat]);

  /**
   * Columnas de la tabla: cuáles se ven y en qué orden.
   *
   * Antes el encabezado y las celdas estaban escritos uno al lado del otro, así que la
   * única forma de sacar una columna era borrar código. Acá cada columna es un objeto con
   * su etiqueta y cómo se dibuja, y la tabla recorre la lista.
   *
   * `numero` y `motivo` no se pueden ocultar ni mover: el número es la referencia del
   * ticket —y lleva el control de orden— y el motivo es lo único que identifica la fila.
   * Sin esos dos, una fila no se entiende.
   */
  const botonOrden = (
    <button
      type="button"
      onClick={() =>
        cambiar({ orden: orden === "" ? "numero_desc" : orden === "numero_desc" ? "numero_asc" : null })
      }
      title={
        orden === "numero_desc"
          ? "Por número, del más nuevo — tocá para invertir"
          : orden === "numero_asc"
            ? "Por número, del más viejo — tocá para volver a última actividad"
            : "Ordenar por número"
      }
      className={`-ml-1 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-bold uppercase tracking-wide shadow-sm transition-colors ${
        orden ? "border-[#4FAEB2] bg-[#4FAEB2] text-white" : "border-[#4FAEB2]/50 bg-white text-[#2F6E71] hover:bg-[#4FAEB2]/10"
      }`}
    >
      N°
      <span aria-hidden className="text-[11px] leading-none">
        {orden === "numero_desc" ? "↓" : orden === "numero_asc" ? "↑" : "⇅"}
      </span>
    </button>
  );

  const COLUMNAS = useMemo(() => {
    const defs: {
      id: string;
      etiqueta: string;
      fija?: boolean;
      th: string;
      td: string;
      celda: (t: TicketLista) => React.ReactNode;
    }[] = [
      {
        id: "numero", etiqueta: "N°", fija: true, th: "w-24 px-5 py-3", td: "relative px-5 py-3.5",
        celda: (t) => (
          <>
            {/* Filete del color del estado al pasar el mouse. */}
            <span className="absolute inset-y-2 left-0 w-1 rounded-r-full opacity-0 transition-opacity group-hover:opacity-100" style={{ backgroundColor: t.estado_color }} aria-hidden />
            <span className="font-bold tabular-nums text-slate-400 group-hover:text-[#2F6E71]">{numeroTicket(t.numero)}</span>
          </>
        ),
      },
      {
        id: "motivo", etiqueta: "Motivo", fija: true, th: "px-3 py-3", td: "min-w-[320px] max-w-[460px] px-3 py-3.5",
        celda: (t) => (
          <>
            <Link href={`/dashboard/soporte/tickets/${t.id}`} onClick={(e) => e.stopPropagation()} className="line-clamp-3 font-semibold text-slate-800 no-underline group-hover:text-[#2F6E71]">
              {t.origen_subestado ?? <span className="font-normal italic text-slate-400">Sub-estado no cargado</span>}
            </Link>
            {t.sla.estado === "vencido" ? (
              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10.5px] font-bold text-rose-600">
                <AlarmClock className="h-3 w-3" aria-hidden /> SLA vencido
              </span>
            ) : t.sla.estado === "en_riesgo" ? (
              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-bold text-amber-600">
                <AlarmClock className="h-3 w-3" aria-hidden /> SLA en riesgo
              </span>
            ) : null}
          </>
        ),
      },
      {
        id: "cliente", etiqueta: "Cliente", th: "px-3 py-3", td: "max-w-[190px] truncate px-3 py-3.5 font-medium text-slate-600",
        celda: (t) => t.cliente_nombre ?? "—",
      },
      {
        id: "proyecto", etiqueta: "Proyecto", th: "px-3 py-3", td: "max-w-[180px] px-3 py-3.5 text-slate-600",
        celda: (t) =>
          t.proyectos_cliente.length === 0 ? (
            <span className="text-slate-300">—</span>
          ) : (
            <span className="flex items-center gap-1.5" title={t.proyectos_cliente.map((x) => x.titulo).join(" · ")}>
              <Link href={`/dashboard/proyectos?proyecto=${t.proyectos_cliente[0].id}`} onClick={(e) => e.stopPropagation()} className="truncate font-medium text-[#3F8E91] hover:underline">
                {t.proyectos_cliente[0].titulo}
              </Link>
              {t.proyectos_cliente.length > 1 ? (
                <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">+{t.proyectos_cliente.length - 1}</span>
              ) : null}
            </span>
          ),
      },
      {
        id: "tipo", etiqueta: "Tipo", th: "px-3 py-3", td: "px-3 py-3.5 text-slate-600",
        celda: (t) => cat?.tipos.find((x) => x.codigo === t.tipo_codigo)?.nombre ?? t.tipo_etiqueta,
      },
      {
        id: "estado", etiqueta: "Estado", th: "px-3 py-3", td: "px-3 py-3.5",
        celda: (t) => (
          <>
            <Insignia color={t.estado_color} punto>{t.estado_nombre}</Insignia>
            <Fase n={t.fase} bloque />
          </>
        ),
      },
      {
        id: "clasificacion", etiqueta: "Clasificación", th: "px-3 py-3", td: "px-3 py-3.5",
        celda: (t) => <span className="text-slate-600">{t.clasificacion_nombre ?? <span className="text-slate-300">—</span>}</span>,
      },
      ...(ocultarResponsable
        ? []
        : [{
            id: "responsable", etiqueta: "Asignado a", th: "px-3 py-3", td: "px-3 py-3.5",
            celda: (t: TicketLista) => (
              <div className="flex items-center gap-2">
                {t.responsable ? (
                  <span className="inline-flex min-w-0 max-w-[160px] items-center gap-2 font-medium text-slate-700" title={t.responsable.nombre}>
                    <Avatar nombre={t.responsable.nombre} tam={24} />
                    <span className="truncate">{t.responsable.nombre}</span>
                  </span>
                ) : (
                  <span className="text-[12px] italic text-slate-400">Sin asignar</span>
                )}
                {puedoTomar && t.responsable?.id !== cat?.usuario_id && t.estado_codigo !== "cerrado" && t.estado_codigo !== "cancelado" ? (
                  <button
                    type="button"
                    disabled={tomando === t.id}
                    onClick={(e) => { e.stopPropagation(); void tomar(t.id); }}
                    title="Asignarme este ticket"
                    className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#4FAEB2]/40 bg-white px-2 py-1 text-[11px] font-bold text-[#2F6E71] opacity-0 transition hover:bg-[#4FAEB2]/10 focus:opacity-100 group-hover:opacity-100 disabled:opacity-60"
                  >
                    {tomando === t.id ? "…" : "Tomar"}
                  </button>
                ) : null}
              </div>
            ),
          }]),
      {
        id: "creador", etiqueta: "Cargado por", th: "px-3 py-3", td: "px-3 py-3.5",
        celda: (t) =>
          t.creador ? (
            <span className="inline-flex min-w-0 max-w-[160px] items-center gap-2 font-medium text-slate-700" title={t.creador.nombre}>
              <Avatar nombre={t.creador.nombre} tam={24} />
              <span className="truncate">{t.creador.nombre}</span>
            </span>
          ) : (
            <span className="text-[12px] italic text-slate-400">—</span>
          ),
      },
      {
        id: "actualizado", etiqueta: "Actualizado", th: "px-5 py-3 text-right", td: "whitespace-nowrap px-5 py-3.5 text-right text-[12.5px] tabular-nums text-slate-500",
        celda: (t) => fechaHora(t.updated_at),
      },
      {
        id: "creado", etiqueta: "Creado", th: "px-5 py-3 text-right", td: "whitespace-nowrap px-5 py-3.5 text-right text-[12.5px] tabular-nums text-slate-400",
        celda: (t) => fechaHora(t.created_at),
      },
    ];
    return defs;
    // `cat`, `tomando` y `puedoTomar` cambian con los datos; el resto es estático.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat, tomando, puedoTomar, ocultarResponsable, router]);

  /** Todas, en el orden elegido. El panel las necesita completas para poder reactivarlas. */
  const columnasOrdenadas = useMemo(() => {
    const porId = new Map(COLUMNAS.map((c) => [c.id, c] as const));
    const ordenadas = colOrden.map((id) => porId.get(id)).filter((c): c is (typeof COLUMNAS)[number] => Boolean(c));
    // Las que el registro tiene y la preferencia guardada no conoce (columnas nuevas) van al final.
    for (const c of COLUMNAS) if (!colOrden.includes(c.id)) ordenadas.push(c);
    return ordenadas;
  }, [COLUMNAS, colOrden]);

  const columnasVisibles = useMemo(
    () => columnasOrdenadas.filter((c) => c.fija || !colOcultas.includes(c.id)),
    [columnasOrdenadas, colOcultas]
  );

  // Filas desplegadas: se puede abrir más de una a la vez (sirve para comparar dos tickets).
  // No se guarda entre recargas a propósito: es una ayuda para barrer la lista, no una preferencia.
  const [desplegados, setDesplegados] = useState<Set<string>>(() => new Set());
  const alternarDespliegue = useCallback((id: string) => {
    setDesplegados((prev) => {
      const sig = new Set(prev);
      if (!sig.delete(id)) sig.add(id);
      return sig;
    });
  }, []);

  const hayFiltros = Object.values(filtros).some(Boolean) || (!soloMios && soloMiosEfectivo);
  const total = datos?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const desde = total === 0 ? 0 : (pagina - 1) * porPagina + 1;
  const hasta = Math.min(total, pagina * porPagina);

  return (
    <div className="space-y-4">
      {/* Pestañas */}
      <div className="flex gap-1.5 overflow-x-auto rounded-2xl border border-slate-200/80 bg-white/80 p-1.5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] backdrop-blur">
        {pestanas.map((p) => {
          const sel = p.id === pestana.id;
          const t = TONOS[tonoPestana(p)];
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => cambiar({ pestana: p.id === pestanas[0].id ? null : p.id })}
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-[13px] font-semibold transition ${
                sel ? `${t.suave} ${t.texto} ring-1 ring-inset ${t.borde}` : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${t.solido}`} aria-hidden />
              {p.etiqueta}
              {datos ? (
                <span className={`rounded-full px-1.5 text-[11px] font-bold tabular-nums ${sel ? "bg-white/70" : "bg-slate-100 text-slate-500"}`}>{contador(p)}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.05),0_8px_24px_-12px_rgba(15,23,42,0.08)]">
        {/* Filtros.
            Antes eran siete columnas fijas siempre a la vista: no entraba nada más y en
            pantallas chicas se cortaba. Ahora la fila es corta —buscar, filtros, fechas— y
            lo demás vive en un panel que se abre abajo. */}
        <div className="border-b border-slate-100 bg-gradient-to-r from-[#4FAEB2]/[0.05] via-white to-sky-50/40 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            {/* Buscar: una lupa que se abre. El campo ocupaba un tercio de la barra para
                algo que se usa de a ratos. */}
            {buscadorAbierto || filtros.q ? (
              <label className="relative min-w-[260px] flex-1 sm:max-w-2xl">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#4FAEB2]" aria-hidden />
                <input
                  autoFocus
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Escape") return;
                    setTexto("");
                    cambiar({ q: null });
                    setBuscadorAbierto(false);
                  }}
                  placeholder="Buscar por motivo, cliente, proyecto o #número…"
                  aria-label="Buscar tickets"
                  className={`${claseInput} pl-9 pr-8`}
                />
                <button
                  type="button"
                  onClick={() => {
                    setTexto("");
                    cambiar({ q: null });
                    setBuscadorAbierto(false);
                  }}
                  aria-label="Cerrar la búsqueda"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </label>
            ) : (
              <button
                type="button"
                onClick={() => setBuscadorAbierto(true)}
                aria-label="Buscar tickets"
                title="Buscar"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:border-[#4FAEB2]/60 hover:text-[#2F6E71]"
              >
                <Search className="h-4 w-4" aria-hidden />
              </button>
            )}

            {/* Filtros: abre el panel de abajo. El número dice cuántos están puestos, para
                no tener que abrirlo sólo para saber si hay alguno. */}
            <button
              type="button"
              onClick={() => setPanelAbierto((v) => !v)}
              aria-expanded={panelAbierto}
              title="Filtros"
              className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-[12.5px] font-semibold transition-colors ${
                panelAbierto || filtrosPuestos > 0
                  ? "border-[#4FAEB2] bg-[#4FAEB2]/10 text-[#2F6E71]"
                  : "border-slate-200 bg-white text-slate-600 hover:border-[#4FAEB2]/60 hover:text-[#2F6E71]"
              }`}
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden />
              Filtros
              {filtrosPuestos > 0 ? (
                <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#4FAEB2] px-1 text-[10px] font-bold text-white">
                  {filtrosPuestos}
                </span>
              ) : null}
            </button>

            {/* Embudo: qué columnas se ven y en qué orden. */}
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setEmbudoAbierto((v) => !v)}
                aria-expanded={embudoAbierto}
                title="Columnas"
                className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[12.5px] font-semibold transition-colors ${
                  embudoAbierto || colOcultas.length > 0
                    ? "border-[#4FAEB2] bg-[#4FAEB2]/10 text-[#2F6E71]"
                    : "border-slate-200 bg-white text-slate-600 hover:border-[#4FAEB2]/60 hover:text-[#2F6E71]"
                }`}
              >
                <Filter className="h-4 w-4" aria-hidden />
                Columnas
              </button>
              {embudoAbierto ? (
                <>
                  <button type="button" aria-label="Cerrar" className="fixed inset-0 z-20 cursor-default" onClick={() => setEmbudoAbierto(false)} />
                  <div className="absolute left-0 top-11 z-30 w-72 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                    <p className="px-2 pb-1.5 pt-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Columnas</p>
                    <ul className="max-h-[60vh] overflow-y-auto">
                      {columnasOrdenadas.map((c, i) => {
                        const oculta = colOcultas.includes(c.id);
                        const ids = columnasOrdenadas.map((x) => x.id);
                        const mover = (delta: number) => {
                          const j = i + delta;
                          if (j < 0 || j >= ids.length) return;
                          const copia = [...ids];
                          [copia[i], copia[j]] = [copia[j], copia[i]];
                          guardarColumnas(copia, colOcultas);
                        };
                        return (
                          <li key={c.id} className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 hover:bg-slate-50">
                            <label className={`flex min-w-0 flex-1 items-center gap-2 text-[13px] ${c.fija ? "text-slate-400" : "cursor-pointer text-slate-700"}`}>
                              <input
                                type="checkbox"
                                checked={c.fija || !oculta}
                                disabled={c.fija}
                                onChange={() =>
                                  guardarColumnas(ids, oculta ? colOcultas.filter((x) => x !== c.id) : [...colOcultas, c.id])
                                }
                                className="h-3.5 w-3.5 accent-[#4FAEB2]"
                              />
                              <span className="truncate">{c.etiqueta}</span>
                              {c.fija ? <span className="shrink-0 text-[10px] uppercase">fija</span> : null}
                            </label>
                            <button type="button" onClick={() => mover(-1)} disabled={i === 0} aria-label={`Subir ${c.etiqueta}`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-25">↑</button>
                            <button type="button" onClick={() => mover(1)} disabled={i === columnasOrdenadas.length - 1} aria-label={`Bajar ${c.etiqueta}`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-25">↓</button>
                          </li>
                        );
                      })}
                    </ul>
                    <button
                      type="button"
                      onClick={() => guardarColumnas([], [])}
                      className="mt-1 w-full rounded-lg px-2 py-1.5 text-[12px] font-semibold text-slate-500 hover:bg-slate-50"
                    >
                      Volver a como estaba
                    </button>
                  </div>
                </>
              ) : null}
            </div>

            <span className="hidden h-6 w-px bg-slate-200 sm:block" aria-hidden />

            {/* Fechas de uso diario, a un toque. El rango fino está en el panel. */}
            {([["Hoy", hoyISO()], ["Ayer", ayerISO()]] as const).map(([etq, dia]) => {
              const puesto = filtros.desde === dia && filtros.hasta === dia;
              return (
                <button
                  key={etq}
                  type="button"
                  onClick={() => cambiar(puesto ? { desde: null, hasta: null } : { desde: dia, hasta: dia })}
                  aria-pressed={puesto}
                  className={`h-9 shrink-0 rounded-xl border px-3 text-[12.5px] font-semibold transition-colors ${
                    puesto
                      ? "border-[#4FAEB2] bg-[#4FAEB2] text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-[#4FAEB2]/60 hover:text-[#2F6E71]"
                  }`}
                >
                  {etq}
                </button>
              );
            })}
            <label
              title="Elegir un día"
              className={`inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border px-2.5 text-[12.5px] font-semibold transition-colors ${
                filtros.desde && filtros.desde === filtros.hasta && ![hoyISO(), ayerISO()].includes(filtros.desde)
                  ? "border-[#4FAEB2] bg-[#4FAEB2]/10 text-[#2F6E71]"
                  : "border-slate-200 bg-white text-slate-600 hover:border-[#4FAEB2]/60"
              }`}
            >
              <CalendarDays className="h-4 w-4" aria-hidden />
              <input
                type="date"
                value={filtros.desde && filtros.desde === filtros.hasta ? filtros.desde : ""}
                onChange={(e) => {
                  const d = e.target.value;
                  cambiar(d ? { desde: d, hasta: d } : { desde: null, hasta: null });
                }}
                aria-label="Elegir un día"
                className="w-[7.5rem] bg-transparent text-[12.5px] outline-none"
              />
            </label>

            <span className="flex-1" />

            {soloMios ? null : (
              <button
                type="button"
                onClick={() => cambiar({ mios: soloMiosEfectivo ? null : "1" })}
                aria-pressed={soloMiosEfectivo}
                title="Sólo los tickets donde tengo la próxima acción"
                className={`inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 text-[12px] font-semibold transition-colors ${
                  soloMiosEfectivo
                    ? "border-[#4FAEB2] bg-[#4FAEB2]/10 text-[#2F6E71]"
                    : "border-slate-200 bg-white text-slate-600 hover:border-[#4FAEB2]/60 hover:text-[#2F6E71]"
                }`}
              >
                <UserRoundCheck className="h-3.5 w-3.5" aria-hidden /> Mis tickets
              </button>
            )}
            <button
              type="button"
              onClick={() => cambiar({ cargados: soloCargados ? null : "1" })}
              aria-pressed={soloCargados}
              title="Sólo los tickets que cargué yo"
              className={`inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 text-[12px] font-semibold transition-colors ${
                soloCargados
                  ? "border-[#4FAEB2] bg-[#4FAEB2]/10 text-[#2F6E71]"
                  : "border-slate-200 bg-white text-slate-600 hover:border-[#4FAEB2]/60 hover:text-[#2F6E71]"
              }`}
            >
              <UserPen className="h-3.5 w-3.5" aria-hidden /> Cargados por mí
            </button>

            {hayFiltros ? (
              <button
                type="button"
                onClick={() => {
                  setTexto("");
                  cambiar({ q: null, cliente_id: null, estado: null, tipo: null, responsable_id: null, cargados: null, desde: null, hasta: null, mios: null });
                }}
                className="inline-flex h-9 shrink-0 items-center gap-1 rounded-xl px-2.5 text-[12px] font-semibold text-rose-500 hover:bg-rose-50"
              >
                <X className="h-3.5 w-3.5" aria-hidden /> Limpiar
              </button>
            ) : null}
          </div>

          {/* Panel: lo que no se usa a cada rato. Se abre y se cierra sin perder lo elegido. */}
          {panelAbierto ? (
            <div className="mt-2.5 grid gap-2 border-t border-slate-200/70 pt-2.5 sm:grid-cols-2 lg:grid-cols-4">
              <SelectorBuscable tam="sm" avatares ariaLabel="Cliente" opciones={[{ value: "", label: "Todos los clientes" }, ...clientes.map((c) => ({ value: c.id, label: c.nombre }))]} value={filtros.cliente_id} onChange={(v) => cambiar({ cliente_id: v || null })} placeholder="Todos los clientes" buscarPlaceholder="Buscar cliente…" vacio="Ningún cliente coincide" />
              <FancySelect size="sm" ariaLabel="Estado" value={filtros.estado} onChange={(v) => cambiar({ estado: v || null })} options={op.estado} />
              <FancySelect size="sm" ariaLabel="Tipo" value={filtros.tipo} onChange={(v) => cambiar({ tipo: v || null })} options={op.tipo} />
              {ocultarResponsable ? null : (
                <SelectorBuscable tam="sm" avatares ariaLabel="Asignado a" value={filtros.responsable_id} onChange={(v) => cambiar({ responsable_id: v || null })} opciones={op.responsable} buscarPlaceholder="Buscar persona o área…" vacio="Nadie coincide" />
              )}
              <label className="flex items-center gap-2 text-[12px] text-slate-500 sm:col-span-2">
                Entre
                <input type="date" value={filtros.desde} onChange={(e) => cambiar({ desde: e.target.value || null })} aria-label="Desde" className={claseInput} />
                y
                <input type="date" value={filtros.hasta} onChange={(e) => cambiar({ hasta: e.target.value || null })} aria-label="Hasta" className={claseInput} />
              </label>
            </div>
          ) : null}
        </div>

        {/* Barra de progreso fina mientras se refresca: no tapa lo que ya se ve. */}
        <div className={`h-0.5 overflow-hidden ${cargando && datos ? "opacity-100" : "opacity-0"} transition-opacity`}>
          <div className="h-full w-1/3 animate-[soporteBarra_1s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-[#4FAEB2] to-transparent" />
        </div>

        {error && !datos ? (
          <div className="p-4"><Aviso>{error}</Aviso></div>
        ) : !datos ? (
          <Cargando filas={6} />
        ) : datos.tickets.length === 0 ? (
          <Vacio
            icono={Inbox}
            titulo={hayFiltros ? "Ningún ticket coincide con los filtros" : soloMiosEfectivo ? "No tenés tickets en esta vista" : "Todavía no hay tickets"}
            detalle={hayFiltros ? "Probá quitando algún filtro." : undefined}
          />
        ) : (
          <>
            {/* Desktop: la tabla scrollea de lado sola cuando el cursor se acerca a
                un borde (izq/der). Sin cajita ni alto fijo. */}
            <div
              ref={scrollRef}
              onMouseMove={autoScrollBorde}
              onMouseLeave={pararAutoScroll}
              className="scroll-x-barra hidden overflow-x-auto md:block"
            >
              <table className="w-full min-w-[1040px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    {/* La flechita no entra en el embudo: es parte de la fila, no una columna de datos. */}
                    <th className="w-9 px-1 py-2.5" aria-label="Ver la descripción" />
                    {columnasVisibles.map((c) => (
                      <th key={c.id} className={c.th}>
                        {c.id === "numero" ? botonOrden : c.etiqueta}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {datos.tickets.map((t) => {
                    const abierto = desplegados.has(t.id);
                    const texto = (t.descripcion ?? "").trim();
                    return (
                      <Fragment key={t.id}>
                        <tr
                          onMouseEnter={() => {
                            precargarTicket(t.id);
                            router.prefetch(`/dashboard/soporte/tickets/${t.id}`);
                          }}
                          onClick={() => router.push(`/dashboard/soporte/tickets/${t.id}`)}
                          className={`group relative cursor-pointer transition-colors hover:bg-[#4FAEB2]/[0.04] ${
                            abierto ? "border-b-0" : "border-b border-slate-100 last:border-0"
                          }`}
                        >
                          <td className="px-1 py-2.5 align-middle">
                            {/* Despliega la descripción sin salir de la lista: el click no tiene que
                                llegar a la fila, que navega al ticket. */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                alternarDespliegue(t.id);
                              }}
                              aria-expanded={abierto}
                              aria-label={abierto ? `Ocultar la descripción del ticket ${t.numero}` : `Ver la descripción del ticket ${t.numero}`}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                            >
                              <ChevronDown className={`h-4 w-4 transition-transform duration-150 ${abierto ? "rotate-180" : ""}`} />
                            </button>
                          </td>
                          {columnasVisibles.map((c) => (
                            <td key={c.id} className={c.td}>
                              {c.celda(t)}
                            </td>
                          ))}
                        </tr>
                        {abierto && (
                          <tr className="border-b border-slate-100 last:border-0">
                            <td />
                            <td colSpan={columnasVisibles.length} className="px-3 pb-3 pt-0">
                              <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2.5">
                                {texto ? (
                                  <p className="line-clamp-4 whitespace-pre-line text-[13px] leading-relaxed text-slate-600">{texto}</p>
                                ) : (
                                  <p className="text-[13px] italic text-slate-400">Este ticket no tiene descripción cargada.</p>
                                )}
                                <Link
                                  href={`/dashboard/soporte/tickets/${t.id}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="mt-2 inline-block text-[12px] font-semibold text-[#2F7F83] hover:underline"
                                >
                                  Ver el ticket completo →
                                </Link>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Móvil */}
            <ul className="divide-y divide-slate-100 md:hidden">
              {datos.tickets.map((t) => (
                <li key={t.id}>
                  <Link href={`/dashboard/soporte/tickets/${t.id}`} className="relative block px-4 py-3 no-underline active:bg-slate-50">
                    <span className="absolute inset-y-3 left-0 w-1 rounded-r-full" style={{ backgroundColor: t.estado_color }} aria-hidden />
                    <div className="flex items-center justify-between gap-2 text-[12px] text-slate-500">
                      <span className="font-bold tabular-nums">{numeroTicket(t.numero)} · {t.cliente_nombre ?? "Sin cliente"}</span>
                      <span className="tabular-nums">{fechaHora(t.updated_at)}</span>
                    </div>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{t.origen_subestado ?? <span className="font-normal italic text-slate-400">Sub-estado no cargado</span>}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Insignia color={t.estado_color} punto>{t.estado_nombre}</Insignia>
                      <Fase n={t.fase} />
                      {t.clasificacion_nombre ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11.5px] font-semibold text-slate-600">{t.clasificacion_nombre}</span> : null}
                      {t.proyectos_cliente.length > 0 ? (
                        <span
                          className="rounded-full bg-[#4FAEB2]/10 px-2 py-0.5 text-[11.5px] font-semibold text-[#3F8E91]"
                          title={t.proyectos_cliente.map((p) => p.titulo).join(" · ")}
                        >
                          {t.proyectos_cliente[0].titulo}
                          {t.proyectos_cliente.length > 1 ? ` +${t.proyectos_cliente.length - 1}` : ""}
                        </span>
                      ) : null}
                    </div>
                    {t.creador ? <p className="mt-1 text-[11.5px] text-slate-400">Cargado por {t.creador.nombre}</p> : null}
                  </Link>
                </li>
              ))}
            </ul>

            {/* Paginación */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3 text-[12px] text-slate-500">
              <div className="flex items-center gap-3">
                <span className="tabular-nums">
                  Mostrando <b className="text-slate-700">{desde}</b> a <b className="text-slate-700">{hasta}</b> de <b className="text-slate-700">{total}</b> tickets
                </span>
                <label className="flex items-center gap-1.5">
                  <span>Ver</span>
                  <select
                    value={porPagina}
                    onChange={(e) => cambiar({ por_pagina: e.target.value === String(POR_PAGINA) ? null : e.target.value })}
                    aria-label="Tickets por página"
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 font-semibold text-slate-700 focus:border-[#4FAEB2] focus:outline-none"
                  >
                    {OPCIONES_POR_PAGINA.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                  <span>por página</span>
                </label>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" disabled={pagina <= 1} onClick={() => cambiar({ pagina: String(pagina - 1) })} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-[#4FAEB2]/50 disabled:opacity-40" aria-label="Página anterior">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                {Array.from({ length: paginas }, (_, i) => i + 1)
                  .filter((n) => n === 1 || n === paginas || Math.abs(n - pagina) <= 1)
                  .map((n, i, arr) => (
                    <span key={n} className="flex items-center gap-1">
                      {i > 0 && n - arr[i - 1] > 1 ? <span className="px-1">…</span> : null}
                      <button
                        type="button"
                        onClick={() => cambiar({ pagina: String(n) })}
                        aria-current={n === pagina ? "page" : undefined}
                        className={`h-8 min-w-8 rounded-lg px-2 font-semibold tabular-nums ${
                          n === pagina ? "bg-[#4FAEB2] text-white shadow-[0_4px_12px_-4px_rgba(79,174,178,0.8)]" : "border border-slate-200 bg-white text-slate-600 hover:border-[#4FAEB2]/50"
                        }`}
                      >
                        {n}
                      </button>
                    </span>
                  ))}
                <button type="button" disabled={pagina >= paginas} onClick={() => cambiar({ pagina: String(pagina + 1) })} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-[#4FAEB2]/50 disabled:opacity-40" aria-label="Página siguiente">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
