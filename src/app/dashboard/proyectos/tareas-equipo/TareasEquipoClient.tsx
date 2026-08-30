"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import SpotlightCard from "@/components/reactbits/SpotlightCard";
import { FancySelect } from "@/app/dashboard/proyectos/components/FancySelect";
import ProyectoDetalleModal from "@/app/dashboard/proyectos/components/ProyectoDetalleModal";
import { type ProyectoEtapaDesarrollo } from "@/lib/proyectos/etapas-desarrollo";
import {
  QA_ETAPAS,
  qaEtapaColor,
  qaEtapaLabel,
  type ProyectoEtapaQA,
} from "@/lib/proyectos/etapas-qa";
import { formatearDuracion, enJornadas, msLaborables } from "@/lib/proyectos/reloj-laboral";
import { textoEsqueleto } from "@/lib/proyectos/esqueleto";
import { coincideBusqueda, tokenizarBusqueda } from "@/lib/proyectos/busqueda";
import { FechaSelect } from "@/components/ui/FechaSelect";

type EstadoTableroDTO = { id: string; codigo: string; nombre: string; color: string };

type ActivoItem = {
  id: string;
  titulo: string;
  cliente: string;
  tipo: string;
  tipo_codigo: string;
  prioridad: string;
  estado_id: string;
  estado_codigo: string;
  estado_nombre: string;
  estado_color: string;
  /** Horario laboral acumulado al momento de la respuesta; el cliente lo hace correr. */
  ms_trabajados: number | null;
  desde: string | null;
  fecha_prometida: string | null;
  bloqueado: boolean;
  pausado: boolean;
  pausa_motivo: string | null;
  pausado_at: string | null;
  esqueleto: "ok" | "por_vencer" | "vencido" | null;
  esqueleto_restante_ms: number | null;
  qa_responsable_id: string | null;
  qa_responsable_nombre: string | null;
  qa_etapa: ProyectoEtapaQA | null;
  /** Quién desarrolla. Lo usa la vista comercial, que agrupa por asesor. */
  tecnico_nombre: string | null;
};

type SeccionEstado = {
  estado_id: string;
  codigo: string;
  nombre: string;
  color: string;
  cantidad: number;
  proyectos: ActivoItem[];
};

type GrupoActivo = {
  tecnico_id: string | null;
  tecnico_nombre: string;
  cantidad: number;
  pausados: number;
  alertas_esqueleto: number;
  secciones: SeccionEstado[];
};

type QAItem = {
  id: string;
  titulo: string;
  cliente: string;
  tipo: string;
  qa_etapa: ProyectoEtapaQA;
  etapa_desarrollo: ProyectoEtapaDesarrollo;
  ms_trabajados: number | null;
  desde: string | null;
  fecha_prometida: string | null;
  pausado: boolean;
  pausa_motivo: string | null;
  tecnico_nombre: string | null;
};

type GrupoQA = {
  qa_id: string;
  qa_nombre: string;
  cantidad: number;
  /** Pasadas por QA ya cerradas, histórico. */
  revisiones_cerradas: number;
  /** Promedio de horario laboral por revisión, en ms. */
  ms_promedio_revision: number | null;
  proyectos: QAItem[];
};

type FinalizadoItem = {
  id: string;
  titulo: string;
  cliente: string;
  tipo: string;
  finalizado_at: string;
  ms_trabajados: number | null;
};

type GrupoFinalizado = {
  tecnico_id: string | null;
  tecnico_nombre: string;
  cantidad: number;
  promedio_ms: number | null;
  proyectos: FinalizadoItem[];
};

type TareasEquipoData = {
  mes: string;
  desde: string;
  hasta: string;
  generado_at: string;
  estados_tablero: EstadoTableroDTO[];
  activos_total: number;
  activos_por_programador: GrupoActivo[];
  /** Los mismos activos, agrupados por asesor comercial. */
  activos_por_comercial: GrupoActivo[];
  qa_total: number;
  qa_por_responsable: GrupoQA[];
  finalizados_total: number;
  finalizados_por_programador: GrupoFinalizado[];
};

/**
 * `es_qa` marca a la gente de QA. No es un rol de permisos: sólo decide qué
 * vocabulario de etapas usa su tarjeta en este tablero.
 */
type Usuario = { id: string; nombre?: string | null; es_qa?: boolean };

type ApiResponse = { success: boolean; data?: TareasEquipoData; error?: string };

/**
 * Qué significa cada etapa de QA en términos de acción. Dos de las tres son el
 * veredicto, y sin este texto el selector no deja ver cuál aprueba y cuál
 * rechaza — ni a quién le llega el aviso.
 */
const QA_ETAPA_AYUDA: Record<ProyectoEtapaQA, string> = {
  revision_pre_entrega: "En revisión, sin avisos",
  cambios: "Rechazar · avisa al programador",
  finalizado: "Aprobar · avisa a la project manager",
};

/** Paleta estable por nombre: el mismo programador conserva su color entre cargas. */
const AVATAR_PALETTE = [
  { bg: "#4FAEB2", soft: "rgba(79,174,178,0.10)" },
  { bg: "#8b5cf6", soft: "rgba(139,92,246,0.10)" },
  { bg: "#f59e0b", soft: "rgba(245,158,11,0.10)" },
  { bg: "#059669", soft: "rgba(5,150,105,0.10)" },
  { bg: "#f43f5e", soft: "rgba(244,63,94,0.10)" },
  { bg: "#0284c7", soft: "rgba(2,132,199,0.10)" },
  { bg: "#6366f1", soft: "rgba(99,102,241,0.10)" },
  { bg: "#d946ef", soft: "rgba(217,70,239,0.10)" },
];

function paleta(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

function initials(name: string) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/** Nombres del catálogo vienen en mayúsculas y largos: acortamos para el listado. */
function nombreCorto(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return name;
  const bonito = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return parts.length === 1 ? bonito(parts[0]) : `${bonito(parts[0])} ${bonito(parts[1])}`;
}

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(ym: string, delta: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return currentYearMonth();
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatMesLargo(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return ym;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  const fmt = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric", timeZone: "UTC" });
  const s = fmt.format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** dd/MM/yy — el encabezado del mensaje de WhatsApp usa este formato. */
function formatFechaCorta(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

function formatFecha(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** dd/MM — fechas cortas dentro de la fila (inicio de pausa, etc.). */
function formatDiaMes(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** ISO -> yyyy-MM-dd en hora local, para prellenar un <input type="date">. */
function isoADateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** dd/MM HH:mm — la fecha/hora de entrega dentro del mensaje. */
function formatEntrega(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return hh === "00" && mi === "00" ? `${dd}/${mm}` : `${dd}/${mm} ${hh}:${mi}`;
}

function etiquetaProyecto(p: { cliente: string; tipo: string }): string {
  const tipo = p.tipo.trim();
  return tipo ? `${p.cliente} (${tipo})` : p.cliente;
}

/**
 * Texto del chip de esqueleto. Se arma en el cliente y no en la API porque las
 * horas restantes cambian mientras la pantalla está abierta.
 */
function textoEsqueletoUI(p: ActivoItem): string | null {
  if (!p.esqueleto || p.esqueleto === "ok") return null;
  return textoEsqueleto({
    aplica: true,
    estado: p.esqueleto,
    transcurridoMs: null,
    restanteMs: p.esqueleto_restante_ms,
  });
}

/**
 * Abre el proyecto en el modal en vez de navegar.
 *
 * Se mantiene el `href` real y sólo se intercepta el click simple: así
 * ctrl/cmd/rueda siguen abriendo el detalle en una pestaña nueva, que es lo que
 * espera cualquiera que quiera comparar dos proyectos.
 */
function abrirEnModal(
  e: React.MouseEvent<HTMLAnchorElement>,
  id: string,
  onAbrir?: (id: string) => void
) {
  if (!onAbrir) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  e.preventDefault();
  onAbrir(id);
}

/** El título sólo aporta si dice algo distinto al nombre del cliente. */
function subtituloUtil(p: { cliente: string; titulo: string }): string | null {
  const norm = (s: string) => s.trim().toLowerCase();
  return norm(p.titulo) && norm(p.titulo) !== norm(p.cliente) ? p.titulo : null;
}

/**
 * Arma el mensaje con el formato que el equipo ya usa en WhatsApp: un bloque por
 * responsable con sus clientes, etapa y días. Los proyectos pausados llevan el
 * motivo en la misma línea — es la información que el resto del equipo pregunta.
 * QA va al final, con sus propias etapas.
 */
/**
 * Mismo formato de mensaje que el del equipo técnico —para que al equipo le
 * resulte familiar— pero agrupado por asesor comercial y sin el tiempo de
 * trabajo, que es una métrica del equipo técnico.
 */
function buildMensajeComercial(grupos: GrupoActivo[]): string {
  const lineas: string[] = ["*Proyectos por comercial*", `*${formatFechaCorta(new Date())}*`, ""];

  for (const g of grupos) {
    const proyectos = g.secciones.flatMap((s) => s.proyectos);
    if (proyectos.length === 0) continue;

    lineas.push("*Comercial:*");
    lineas.push(`•${g.tecnico_id == null ? "Sin asignar" : nombreCorto(g.tecnico_nombre)}`);

    lineas.push("*Cliente:*");
    for (const p of proyectos) {
      const pausa = p.pausado ? ` · ⏸ PAUSADO${p.pausa_motivo ? `: ${p.pausa_motivo}` : ""}` : "";
      const aviso =
        p.esqueleto === "vencido"
          ? " · ⚠ ESQUELETO VENCIDO"
          : p.esqueleto === "por_vencer"
            ? " · ⚠ esqueleto por vencer"
            : "";
      // Quién lo desarrolla es lo primero que se pregunta cuando el mensaje sale
      // de una lista por comercial.
      const dev = p.tecnico_nombre ? ` · dev ${nombreCorto(p.tecnico_nombre)}` : "";
      lineas.push(`•${etiquetaProyecto(p)} — ${p.estado_nombre}${pausa}${aviso}${dev}`);
    }

    // El encabezado sólo va si hay al menos una fecha: si no, queda un título
    // colgado sin nada debajo (pasa cuando ningún proyecto tiene entrega cargada).
    const entregas = proyectos
      .map((p) => ({ cliente: p.cliente, entrega: formatEntrega(p.fecha_prometida) }))
      .filter((e): e is { cliente: string; entrega: string } => e.entrega != null);
    if (entregas.length > 0) {
      lineas.push("*Fecha/hora de entrega:*");
      for (const e of entregas) lineas.push(`•${e.cliente}: ${e.entrega}`);
    }

    lineas.push("");
  }

  return lineas.join("\n").trimEnd();
}

function buildMensajeWhatsapp(grupos: GrupoActivo[], qaGrupos: GrupoQA[]): string {
  const lineas: string[] = ["*Tareas del equipo*", `*${formatFechaCorta(new Date())}*`, ""];

  for (const g of grupos) {
    // Las subsecciones se aplanan: el mensaje de WhatsApp se lee de corrido y el
    // estado ya va escrito en cada línea.
    const proyectos = g.secciones.flatMap((s) => s.proyectos);
    if (proyectos.length === 0) continue;

    lineas.push("*Cliente:*");
    for (const p of proyectos) {
      const tiempo = p.ms_trabajados == null ? "" : ` · ${formatearDuracion(p.ms_trabajados)}`;
      const pausa = p.pausado
        ? ` · ⏸ PAUSADO${p.pausa_motivo ? `: ${p.pausa_motivo}` : ""}`
        : "";
      const aviso =
        p.esqueleto === "vencido"
          ? " · ⚠ ESQUELETO VENCIDO"
          : p.esqueleto === "por_vencer"
            ? " · ⚠ esqueleto por vencer"
            : "";
      lineas.push(`•${etiquetaProyecto(p)} — ${p.estado_nombre}${pausa}${aviso}${tiempo}`);
    }

    lineas.push("*Responsable:*");
    lineas.push(`•${nombreCorto(g.tecnico_nombre)}`);

    lineas.push("*Fecha/hora de entrega:*");
    for (const p of proyectos) {
      const entrega = formatEntrega(p.fecha_prometida);
      if (entrega) lineas.push(`•${p.cliente}: ${entrega}`);
    }

    lineas.push("");
  }

  for (const g of qaGrupos) {
    if (g.proyectos.length === 0) continue;

    lineas.push("*QA — Cliente:*");
    for (const p of g.proyectos) {
      const tiempo = p.ms_trabajados == null ? "" : ` · ${formatearDuracion(p.ms_trabajados)}`;
      const pausa = p.pausado
        ? ` · ⏸ PAUSADO${p.pausa_motivo ? `: ${p.pausa_motivo}` : ""}`
        : "";
      lineas.push(`•${etiquetaProyecto(p)} — ${qaEtapaLabel(p.qa_etapa)}${pausa}${tiempo}`);
    }

    lineas.push("*Responsable:*");
    lineas.push(`•${nombreCorto(g.qa_nombre)}`);

    lineas.push("*Fecha/hora de entrega:*");
    for (const p of g.proyectos) {
      const entrega = formatEntrega(p.fecha_prometida);
      if (entrega) lineas.push(`•${p.cliente}: ${entrega}`);
    }

    lineas.push("");
  }

  return lineas.join("\n").trimEnd();
}

/**
 * Tablero del equipo. Dos pantallas sobre el MISMO universo de proyectos, que
 * se distinguen por el eje de agrupación:
 *
 * - `"equipo"` (por defecto): por programador y por QA, con el contador de
 *   tiempo de trabajo. Es la pantalla de /dashboard/proyectos/tareas-equipo.
 * - `"comercial"`: por asesor comercial, sin contador. Vive en su propia
 *   página (/dashboard/proyectos/comercial) y comparte este componente para no
 *   duplicar la tarjeta y la fila de proyecto.
 */
export default function TareasEquipoClient({
  dataSchema,
  pantalla = "equipo",
}: {
  dataSchema: string;
  pantalla?: "equipo" | "comercial";
}) {
  const [mes, setMes] = useState<string>(() => currentYearMonth());
  const [data, setData] = useState<TareasEquipoData | null>(null);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  /**
   * Tarjetas de equipo desplegadas (`dev:<id>` / `qa:<id>`). Arrancan todas
   * plegadas a propósito: con el listado apilado, el valor de la pantalla es
   * ver a todo el equipo de una — la barra de distribución de cada encabezado
   * ya cuenta en qué anda cada uno — y recién después abrir a quien interese.
   */
  const [equipoAbiertos, setEquipoAbiertos] = useState<Set<string>>(() => new Set());
  /** Proyecto abierto en el modal de detalle, el mismo que usa el Kanban. */
  const [modalProjectId, setModalProjectId] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  /**
   * Vista activa. "curso" y "comercial" son el mismo universo de proyectos
   * mirado por ejes distintos (quién lo desarrolla / quién lo vendió).
   */
  const [vista, setVista] = useState<"curso" | "comercial" | "finalizados">(
    pantalla === "comercial" ? "comercial" : "curso"
  );
  const verFinalizados = vista === "finalizados";

  const load = useCallback(async (target: string) => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetchWithSupabaseSession(
        `/api/proyectos/tareas-equipo?mes=${encodeURIComponent(target)}`,
        { cache: "no-store" }
      );
      const j = (await res.json().catch(() => null)) as ApiResponse | null;
      if (!res.ok || !j?.success || !j.data) {
        setErr(j?.error ?? "No se pudo cargar el tablero del equipo");
        setData(null);
      } else {
        setData(j.data);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de red");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(mes);
  }, [load, mes]);

  useEffect(() => {
    let cancelado = false;
    void (async () => {
      try {
        const res = await fetchWithSupabaseSession("/api/usuarios/empresa-activos", { cache: "no-store" });
        const j = (await res.json().catch(() => null)) as { usuarios?: Usuario[] } | null;
        if (!cancelado) setUsuarios(j?.usuarios ?? []);
      } catch {
        // Sin la lista el tablero sigue sirviendo: se pierde reasignar, nada más.
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  const toggleEquipo = useCallback((key: string) => {
    setEquipoAbiertos((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  /**
   * Claves de todas las tarjetas visibles. Se calcula acá (y no dentro de
   * `ActivosSeccion`) porque "expandir todo" necesita conocerlas desde el
   * componente que guarda el estado.
   */
  const clavesEquipo = useMemo(() => {
    const devs = (data?.activos_por_programador ?? []).map((g) => `dev:${g.tecnico_id ?? "__SIN__"}`);
    const qas = (data?.qa_por_responsable ?? []).map((g) => `qa:${g.qa_id}`);
    return [...devs, ...qas];
  }, [data]);

  const todasEquipoAbiertas = clavesEquipo.length > 0 && clavesEquipo.every((k) => equipoAbiertos.has(k));

  const toggleTodasEquipo = useCallback(() => {
    setEquipoAbiertos((prev) => {
      const todas = clavesEquipo.length > 0 && clavesEquipo.every((k) => prev.has(k));
      return todas ? new Set() : new Set(clavesEquipo);
    });
  }, [clavesEquipo]);

  // La vista comercial comparte el Set de abiertas, pero sus claves llevan otro
  // prefijo (`com:`): así abrir a alguien en una vista no abre a otra persona
  // distinta en la otra.
  const clavesComercial = useMemo(
    () => (data?.activos_por_comercial ?? []).map((g) => `com:${g.tecnico_id ?? "__SIN__"}`),
    [data]
  );

  const todasComercialAbiertas =
    clavesComercial.length > 0 && clavesComercial.every((k) => equipoAbiertos.has(k));

  const toggleTodasComercial = useCallback(() => {
    setEquipoAbiertos((prev) => {
      const todas = clavesComercial.length > 0 && clavesComercial.every((k) => prev.has(k));
      const next = new Set(prev);
      clavesComercial.forEach((k) => (todas ? next.delete(k) : next.add(k)));
      return next;
    });
  }, [clavesComercial]);

  /** Único punto de escritura: todas las ediciones de la fila pasan por acá. */
  const patchProyecto = useCallback(
    async (proyectoId: string, cambios: Record<string, unknown>) => {
      setSavingId(proyectoId);
      setErr(null);
      try {
        const res = await fetchWithSupabaseSession(`/api/proyectos/${proyectoId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cambios),
        });
        const j = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
        if (!res.ok || !j?.success) {
          setErr(j?.error ?? "No se pudo guardar el cambio");
          return;
        }
        // Cualquiera de estos cambios reordena o mueve la tarjeta de grupo, y
        // pasar a Finalizado la saca del listado: recargamos los dos bloques.
        await load(mes);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Error de red");
      } finally {
        setSavingId(null);
      }
    },
    [load, mes]
  );

  /**
   * Cambio de estado del Kanban desde la tarjeta del técnico.
   *
   * Va por la ruta de `cambiar-estado` y no por el PATCH genérico porque ese
   * endpoint es el que cierra el segmento de historial, deja el snapshot de SLA
   * y abre o cierra la pausa. Escribir `estado_id` a mano dejaría todo eso sin
   * registrar.
   */
  const cambiarEstado = useCallback(
    async (proyectoId: string, estadoId: string) => {
      setSavingId(proyectoId);
      setErr(null);
      try {
        const res = await fetchWithSupabaseSession(`/api/proyectos/${proyectoId}/cambiar-estado`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ estado_id: estadoId }),
        });
        const j = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
        if (!res.ok || !j?.success) {
          setErr(j?.error ?? "No se pudo mover el proyecto de estado");
          return;
        }
        await load(mes);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Error de red");
      } finally {
        setSavingId(null);
      }
    },
    [load, mes]
  );

  /**
   * Veredicto de QA. Va por su propia ruta y no por el PATCH del proyecto
   * porque no es sólo mover una etapa: dispara las notificaciones tipadas
   * (aprobado avisa a la project manager, rechazado al programador).
   */
  const veredictoQA = useCallback(
    async (proyectoId: string, aprobado: boolean, motivo: string | null) => {
      setSavingId(proyectoId);
      setErr(null);
      try {
        const res = await fetchWithSupabaseSession(`/api/proyectos/${proyectoId}/qa/veredicto`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ aprobado, motivo }),
        });
        const j = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
        if (!res.ok || !j?.success) {
          setErr(j?.error ?? "No se pudo registrar el veredicto");
          return;
        }
        await load(mes);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Error de red");
      } finally {
        setSavingId(null);
      }
    },
    [load, mes]
  );

  const mensaje = useMemo(
    () =>
      pantalla === "comercial"
        ? buildMensajeComercial(data?.activos_por_comercial ?? [])
        : buildMensajeWhatsapp(data?.activos_por_programador ?? [], data?.qa_por_responsable ?? []),
    [data, pantalla]
  );

  const copiar = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(mensaje);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      setErr("El navegador bloqueó el portapapeles. Copiá el texto de la vista previa a mano.");
    }
  }, [mensaje]);

  const pausadosTotal = useMemo(
    () => (data?.activos_por_programador ?? []).reduce((acc, g) => acc + g.pausados, 0),
    [data]
  );

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 shrink-0 rounded-full bg-[#4FAEB2] shadow-[0_0_0_3px_rgba(79,174,178,0.18)]"
            />
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#4FAEB2]">
              {pantalla === "comercial" ? "Comercial" : "Equipo"}
            </p>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            {pantalla === "comercial" ? "Proyectos por comercial" : "Tareas del equipo"}
          </h1>
          <p className="text-sm text-slate-500">
            {pantalla === "comercial"
              ? "Proyectos por asesor comercial, divididos por estado, para ver en qué va lo que cada uno vendió."
              : "Proyectos por programador y por QA, divididos por estado, con el tiempo de trabajo acumulado en horario laboral."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void copiar()}
            disabled={!mensaje}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#4FAEB2] px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-[#3F8E91] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            title={
              pantalla === "comercial"
                ? "Copiar el estado por comercial con el formato de WhatsApp"
                : "Copiar el pase del día con el formato de WhatsApp"
            }
          >
            {copiado ? <IconCheck /> : <IconCopy />}
            {copiado ? "¡Copiado!" : "Copiar para WhatsApp"}
          </button>
          <Link
            href="/dashboard/proyectos"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm transition-colors hover:border-[#4FAEB2]/60 hover:text-[#4FAEB2]"
          >
            <IconChevronLeft />
            Volver al tablero
          </Link>
        </div>
      </header>

      <div
        className={`flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm ${
          pantalla === "comercial" ? "justify-between" : ""
        }`}
      >
        <div
          className={`items-center gap-0.5 rounded-xl border border-slate-200 bg-slate-100/80 p-0.5 ${
            pantalla === "comercial" ? "hidden" : "flex"
          }`}
        >
          <button
            type="button"
            onClick={() => setVista("curso")}
            aria-pressed={vista === "curso"}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              vista === "curso" ? "bg-white text-[#3F8E91] shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            En curso ({data?.activos_total ?? 0})
          </button>
          <button
            type="button"
            onClick={() => setVista("finalizados")}
            aria-pressed={vista === "finalizados"}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              vista === "finalizados" ? "bg-white text-[#3F8E91] shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Finalizados ({data?.finalizados_total ?? 0})
          </button>
        </div>

        {!verFinalizados && (data?.qa_total ?? 0) > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700">
            <IconShield />
            {data?.qa_total} en QA
          </span>
        ) : null}

        {!verFinalizados && pausadosTotal > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
            <IconPause />
            {pausadosTotal} {pausadosTotal === 1 ? "pausado" : "pausados"}
          </span>
        ) : null}

        {verFinalizados ? (
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => setMes((m) => shiftMonth(m, -1))}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:border-[#4FAEB2]/60 hover:text-[#4FAEB2]"
              aria-label="Mes anterior"
            >
              <IconChevronLeft />
            </button>
            <input
              type="month"
              value={mes}
              onChange={(e) => setMes(e.target.value || currentYearMonth())}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
              aria-label="Mes a consultar"
            />
            <button
              type="button"
              onClick={() => setMes((m) => shiftMonth(m, 1))}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:border-[#4FAEB2]/60 hover:text-[#4FAEB2]"
              aria-label="Mes siguiente"
            >
              <IconChevronRight />
            </button>
            <span className="ml-2 hidden text-sm text-slate-500 sm:inline">{formatMesLargo(mes)}</span>
          </div>
        ) : vista === "curso" ? (
          <div className="ml-auto flex items-center gap-3 pr-1 text-[11px] text-slate-400">
            <LeyendaDias />
          </div>
        ) : (
          // La vista comercial no muestra contador de tiempo, así que la
          // leyenda de días trabajados no tendría a qué referirse.
          <div className="ml-auto pr-1 text-[11px] text-slate-400">
            Estado de los proyectos por asesor comercial.
          </div>
        )}
      </div>

      {err ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{err}</div>
      ) : null}

      {loading && !data ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          Cargando tablero…
        </div>
      ) : vista === "finalizados" ? (
        <FinalizadosSeccion data={data} mes={mes} onAbrir={setModalProjectId} />
      ) : (
        <>
          {vista === "comercial" ? (
            <ComercialSeccion
              grupos={data?.activos_por_comercial ?? []}
              estados={data?.estados_tablero ?? []}
              generadoAt={data?.generado_at ?? null}
              savingId={savingId}
              abiertas={equipoAbiertos}
              onToggle={toggleEquipo}
              onToggleTodas={toggleTodasComercial}
              todasAbiertas={todasComercialAbiertas}
              onPatch={patchProyecto}
              onVeredicto={veredictoQA}
              onCambiarEstado={cambiarEstado}
              onAbrir={setModalProjectId}
            />
          ) : (
            <ActivosSeccion
              grupos={data?.activos_por_programador ?? []}
              qaGrupos={data?.qa_por_responsable ?? []}
              estados={data?.estados_tablero ?? []}
              generadoAt={data?.generado_at ?? null}
              usuarios={usuarios}
              savingId={savingId}
              abiertas={equipoAbiertos}
              onToggle={toggleEquipo}
              onToggleTodas={toggleTodasEquipo}
              todasAbiertas={todasEquipoAbiertas}
              onPatch={patchProyecto}
              onVeredicto={veredictoQA}
              onCambiarEstado={cambiarEstado}
              onAbrir={setModalProjectId}
            />
          )}
          {/* La vista previa acompaña a las dos pantallas: cada una arma su
              propio mensaje (por programador o por comercial). */}
          {mensaje ? (
            <details className="group rounded-2xl border border-slate-200 bg-white shadow-sm">
              <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-3 text-xs font-semibold text-slate-600 transition-colors hover:text-[#3F8E91]">
                <span className="transition-transform group-open:rotate-90">
                  <IconChevronRight />
                </span>
                Vista previa del mensaje de WhatsApp
              </summary>
              <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap border-t border-slate-100 bg-slate-50/60 px-4 py-3 font-mono text-[12px] leading-relaxed text-slate-700">
                {mensaje}
              </pre>
            </details>
          ) : null}
        </>
      )}

      {/* Mismo modal de detalle que el Kanban y la vista lista. Al cerrarlo se
          recarga el tablero: abrir el proyecto marca leídas sus novedades de QA
          y puede cambiarle el estado o el responsable desde adentro. */}
      <ProyectoDetalleModal
        projectId={modalProjectId}
        open={modalProjectId != null}
        onClose={() => {
          setModalProjectId(null);
          void load(mes);
        }}
        onUpdated={() => void load(mes)}
        dataSchema={dataSchema}
      />
    </div>
  );
}

function LeyendaDias() {
  return (
    <div className="flex items-center gap-2">
      <span className="hidden sm:inline">Días trabajados:</span>
      <span className="inline-flex items-center gap-1">
        <i className="h-2 w-2 rounded-full bg-slate-300" aria-hidden="true" />
        &lt;14
      </span>
      <span className="inline-flex items-center gap-1">
        <i className="h-2 w-2 rounded-full bg-amber-400" aria-hidden="true" />
        14+
      </span>
      <span className="inline-flex items-center gap-1">
        <i className="h-2 w-2 rounded-full bg-rose-400" aria-hidden="true" />
        30+
      </span>
    </div>
  );
}

/**
 * Tarjeta de un responsable. `overflow` queda visible a propósito: los
 * `FancySelect` de las filas despliegan un popover absoluto que un
 * `overflow-hidden` en la tarjeta recortaría.
 */
/** Un tramo de la barra de distribución del encabezado (un estado del tablero). */
type TramoDistribucion = { key: string; nombre: string; cantidad: number; color: string };

/**
 * Tarjeta de una persona del equipo, apilada y plegable.
 *
 * Colapsada tiene que seguir diciendo algo útil: por eso el encabezado lleva
 * la barra de distribución por estado. De un vistazo se ve quién está cargado y
 * en qué etapa está su trabajo, sin abrir a nadie. Las tareas se despliegan al
 * tocar la fila.
 */
function TarjetaGrupo({
  color,
  inicial,
  titulo,
  subtitulo,
  contador,
  badge,
  italic,
  distribucion,
  abierta,
  onToggle,
  children,
}: {
  color: { bg: string; soft: string };
  inicial: string;
  titulo: string;
  subtitulo: string;
  contador: number;
  badge?: React.ReactNode;
  italic?: boolean;
  distribucion: TramoDistribucion[];
  abierta: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const totalTramos = distribucion.reduce((n, d) => n + d.cantidad, 0);
  const panelId = `equipo-panel-${titulo.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-shadow hover:shadow-[0_8px_24px_-12px_rgba(15,23,42,0.12)]">
      <SpotlightCard spotlightColor={`${color.bg}1F` as `rgba(${number}, ${number}, ${number}, ${number})`}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={abierta}
          aria-controls={panelId}
          className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
            abierta ? "bg-slate-50/80" : "hover:bg-slate-50/60"
          }`}
        >
          <span
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
            style={{ backgroundColor: color.soft, color: color.bg }}
            aria-hidden="true"
          >
            {inicial}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className={`truncate text-sm font-semibold ${italic ? "italic text-slate-500" : "text-slate-900"}`}
                title={titulo}
              >
                {titulo}
              </span>
              {badge}
            </div>
            <div className="text-[11px] text-slate-500">{subtitulo}</div>
          </div>

          {/*
            Barra de distribución: un tramo por estado, proporcional. Es lo que
            hace que la lista colapsada siga siendo un reporte y no un índice.
            Los colores los define cada empresa por estado, así que el
            significado lo carga el `title` y el detalle al abrir — nunca el
            color solo.
          */}
          {totalTramos > 0 ? (
            <div className="hidden w-[168px] shrink-0 gap-0.5 md:flex lg:w-[220px]" aria-hidden="true">
              {distribucion.map((d) => (
                <span
                  key={d.key}
                  className="h-1.5 rounded-full first:rounded-l-full last:rounded-r-full"
                  style={{
                    width: `${(d.cantidad / totalTramos) * 100}%`,
                    backgroundColor: d.color,
                  }}
                  title={`${d.nombre}: ${d.cantidad}`}
                />
              ))}
            </div>
          ) : null}

          <span
            className="shrink-0 rounded-full px-2.5 py-1 text-[13px] font-bold tabular-nums"
            style={{ backgroundColor: color.soft, color: color.bg }}
          >
            {contador}
          </span>
          <span
            aria-hidden="true"
            className={`shrink-0 text-slate-400 transition-transform duration-200 ${abierta ? "rotate-180" : ""}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </button>
      </SpotlightCard>
      <AnimatePresence initial={false}>
        {abierta ? (
          <motion.div
            id={panelId}
            key="panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden border-t border-slate-100"
          >
            {children}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}

function ActivosSeccion({
  grupos,
  qaGrupos,
  estados,
  generadoAt,
  usuarios,
  savingId,
  abiertas,
  onToggle,
  onToggleTodas,
  todasAbiertas,
  onPatch,
  onVeredicto,
  onCambiarEstado,
  onAbrir,
}: {
  grupos: GrupoActivo[];
  qaGrupos: GrupoQA[];
  estados: EstadoTableroDTO[];
  generadoAt: string | null;
  usuarios: Usuario[];
  savingId: string | null;
  /** Claves (`dev:<id>` / `qa:<id>`) de las tarjetas desplegadas. */
  abiertas: Set<string>;
  onToggle: (key: string) => void;
  onToggleTodas: () => void;
  todasAbiertas: boolean;
  onPatch: (id: string, cambios: Record<string, unknown>) => void | Promise<void>;
  onVeredicto: (id: string, aprobado: boolean, motivo: string | null) => void | Promise<void>;
  onCambiarEstado: (id: string, estadoId: string) => void | Promise<void>;
  onAbrir: (id: string) => void;
}) {
  // Las tarjetas de QA existen aunque no tengan proyectos, así que el vacío se
  // mide por proyectos y no por tarjetas: si no, este estado nunca se veria.
  const totalProyectos =
    grupos.reduce((n, g) => n + g.cantidad, 0) +
    qaGrupos.reduce((n, g) => n + g.proyectos.length, 0);

  // Vocabulario del selector de cada fila: las columnas del Kanban que le
  // competen al técnico, tal como las configuró la empresa.
  const opcionesEstado = estados.map((e) => ({ value: e.id, label: e.nombre }));
  const estadoPausadoId = estados.find((e) => e.codigo === "pausado")?.id ?? null;
  // Reanudar devuelve el proyecto a la primera columna de trabajo del tablero.
  const estadoReanudarId = estados.find((e) => e.codigo !== "pausado")?.id ?? null;

  if (totalProyectos === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
        <p className="text-sm font-medium text-slate-700">No hay proyectos en curso</p>
        <p className="mt-1 text-xs text-slate-500">
          Ningún proyecto está en las columnas que sigue el equipo técnico
          (Desarrollo, Cambios solicitados, QA, Revisión Cliente, Publicado / Pendiente de Capacitación o Pausado).
        </p>
      </div>
    );
  }

  // Dos listas separadas a propósito: el selector de una tarjeta de programador
  // elige quién desarrolla, y el de una tarjeta de QA elige quién revisa.
  // Mezclarlas dejaba elegir a la QA como programadora, que no es lo que nadie
  // quiere decir cuando la busca en esa lista.
  const opcionesDev = [
    { value: "", label: "Sin asignar" },
    ...usuarios.filter((u) => !u.es_qa).map((u) => ({ value: u.id, label: nombreCorto(u.nombre ?? "") })),
  ];
  const opcionesQA = [
    { value: "", label: "Quitar de QA" },
    ...usuarios.filter((u) => u.es_qa).map((u) => ({ value: u.id, label: nombreCorto(u.nombre ?? "") })),
  ];

  // Programadores y QA conviven en la misma grilla, ordenados por nombre: para
  // el equipo, QA es una integrante más y no una sección aparte.
  type Tarjeta =
    | { kind: "dev"; key: string; orden: string; grupo: GrupoActivo }
    | { kind: "qa"; key: string; orden: string; grupo: GrupoQA };

  const tarjetas: Tarjeta[] = [
    ...grupos.map(
      (g): Tarjeta => ({
        kind: "dev",
        key: `dev:${g.tecnico_id ?? "__SIN__"}`,
        // "Sin asignar" siempre al final, sin importar el alfabeto.
        orden: g.tecnico_id == null ? "￿" : g.tecnico_nombre,
        grupo: g,
      })
    ),
    ...qaGrupos.map(
      (g): Tarjeta => ({ kind: "qa", key: `qa:${g.qa_id}`, orden: g.qa_nombre, grupo: g })
    ),
  ].sort((a, b) => a.orden.localeCompare(b.orden));

  return (
    <div className="space-y-2.5">
      {/*
        Leyenda de la barra de distribución. Sin esto, plegada la tarjeta el
        color no se puede decodificar: los estados los configura cada empresa y
        nadie tiene por qué saber de memoria cuál es cuál.
      */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {estados.map((e) => (
            <span key={e.id} className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
              <i aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: e.color }} />
              {e.nombre}
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={onToggleTodas}
          className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
        >
          {todasAbiertas ? "Contraer todo" : "Expandir todo"}
        </button>
      </div>
      {tarjetas.map((t) => {
        if (t.kind === "qa") {
          const g = t.grupo;
          return (
            <TarjetaGrupo
              key={t.key}
              color={{ bg: "#6366f1", soft: "rgba(99,102,241,0.12)" }}
              inicial={initials(g.qa_nombre)}
              titulo={nombreCorto(g.qa_nombre)}
              subtitulo={[
                g.cantidad === 1 ? "1 proyecto en revisión" : `${g.cantidad} proyectos en revisión`,
                // Tiempo de respuesta: promedio de sus revisiones ya cerradas,
                // en horario laboral. Es la métrica que se le mide.
                g.ms_promedio_revision != null
                  ? `responde en ${formatearDuracion(g.ms_promedio_revision)} (prom. de ${g.revisiones_cerradas})`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              contador={g.cantidad}
              abierta={abiertas.has(t.key)}
              onToggle={() => onToggle(t.key)}
              // QA no se divide por estado del Kanban: sus proyectos se agrupan
              // por etapa de revisión, así que la barra usa esas etapas.
              distribucion={Object.entries(
                g.proyectos.reduce<Record<string, number>>((acc, p) => {
                  acc[p.qa_etapa] = (acc[p.qa_etapa] ?? 0) + 1;
                  return acc;
                }, {})
              ).map(([etapa, cantidad]) => ({
                key: etapa,
                nombre: QA_ETAPAS.find((e) => e.codigo === etapa)?.label ?? etapa,
                cantidad,
                color: qaEtapaColor(etapa as ProyectoEtapaQA),
              }))}
              badge={
                <span className="shrink-0 rounded-md bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700">
                  QA
                </span>
              }
            >
              {g.proyectos.length === 0 ? (
                <p className="px-4 py-6 text-center text-[11px] leading-relaxed text-slate-400">
                  Sin proyectos en revisión.
                  <br />
                  Para mandarle uno, elegila en el selector de responsable del proyecto.
                </p>
              ) : null}
              <ul className="divide-y divide-slate-100">
                {g.proyectos.map((p) => (
                  <FilaProyecto
                    key={p.id}
                    modo="qa"
                    id={p.id}
                    cliente={p.cliente}
                    tipo={p.tipo}
                    titulo={p.titulo}
                    etapa={p.qa_etapa}
                    color={qaEtapaColor(p.qa_etapa)}
                    opcionesEtapa={QA_ETAPAS.map((e) => ({
                      value: e.codigo as string,
                      label: e.label,
                      description: QA_ETAPA_AYUDA[e.codigo],
                    }))}
                    msBase={p.ms_trabajados}
                    generadoAt={generadoAt}
                    asignadoA={g.qa_id}
                    fechaPrometida={p.fecha_prometida}
                    metaExtra={p.tecnico_nombre ? `dev ${nombreCorto(p.tecnico_nombre)}` : null}
                    pausado={p.pausado}
                    pausaMotivo={p.pausa_motivo}
                    pausadoAt={null}
                    bloqueado={false}
                    qaChip={null}
                    desde={p.desde}
                    opcionesUsuario={opcionesQA}
                    saving={savingId === p.id}
                    onPatch={onPatch}
                    onVeredicto={onVeredicto}
                    onAbrir={onAbrir}
                  />
                ))}
              </ul>
            </TarjetaGrupo>
          );
        }

        const g = t.grupo;
        const sinTecnico = g.tecnico_id == null;
        const col = sinTecnico
          ? { bg: "#94a3b8", soft: "rgba(148,163,184,0.14)" }
          : paleta(g.tecnico_nombre);
        return (
          <TarjetaGrupo
            key={t.key}
            color={col}
            inicial={sinTecnico ? "—" : initials(g.tecnico_nombre)}
            titulo={sinTecnico ? "Sin asignar" : nombreCorto(g.tecnico_nombre)}
            italic={sinTecnico}
            subtitulo={`${g.cantidad === 1 ? "1 proyecto" : `${g.cantidad} proyectos`}${
              g.pausados > 0 ? ` · ${g.pausados} en pausa` : ""
            }${g.alertas_esqueleto > 0 ? ` · ${g.alertas_esqueleto} con esqueleto por vencer` : ""}`}
            contador={g.cantidad}
            abierta={abiertas.has(t.key)}
            onToggle={() => onToggle(t.key)}
            distribucion={g.secciones
              .filter((sec) => sec.proyectos.length > 0)
              .map((sec) => ({
                key: sec.estado_id,
                nombre: sec.nombre,
                cantidad: sec.cantidad,
                color: sec.color,
              }))}
          >
            {/*
              Una subsección por estado del Kanban. Las vacías no se dibujan: en
              una tarjeta con seis proyectos en Desarrollo, cuatro encabezados en
              cero son ruido y no información.
            */}
            {g.secciones
              .filter((sec) => sec.proyectos.length > 0)
              .map((sec) => (
                <section
                  key={sec.estado_id}
                  // Banda gruesa entre subsecciones: es lo que hace que se lean
                  // como bloques separados y no como una lista continua.
                  className="border-t-[6px] border-slate-100 first:border-t-0"
                >
                  <header
                    className="flex items-center gap-2 px-4 py-2"
                    style={{
                      // Fondo teñido con el color del estado + riel sólido a la
                      // izquierda. El texto queda en slate: los colores los
                      // configura cada empresa y no se puede garantizar
                      // contraste si se usaran como color de letra.
                      backgroundColor: `${sec.color}1A`,
                      borderLeft: `4px solid ${sec.color}`,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 shrink-0 rounded-full ring-2 ring-white"
                      style={{ backgroundColor: sec.color }}
                    />
                    <h4 className="min-w-0 flex-1 truncate text-[11.5px] font-bold uppercase tracking-[0.07em] text-slate-800">
                      {sec.nombre}
                    </h4>
                    <span
                      className="shrink-0 rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-bold tabular-nums text-slate-700"
                      title={`${sec.cantidad} ${sec.cantidad === 1 ? "proyecto" : "proyectos"} en ${sec.nombre}`}
                    >
                      {sec.cantidad}
                    </span>
                  </header>
                  {/* El riel sigue por las filas, en tono suave, para que el
                      bloque se lea de una sola pieza hasta el final. */}
                  <ul
                    className="divide-y divide-slate-100"
                    style={{ borderLeft: `4px solid ${sec.color}33` }}
                  >
                    {sec.proyectos.map((p) => (
                      <FilaProyecto
                        key={p.id}
                        modo="dev"
                        id={p.id}
                        cliente={p.cliente}
                        tipo={p.tipo}
                        titulo={p.titulo}
                        etapa={p.estado_id}
                        color={p.estado_color}
                        opcionesEtapa={opcionesEstado}
                        msBase={p.ms_trabajados}
                        generadoAt={generadoAt}
                        esqueleto={p.esqueleto}
                        esqueletoTexto={textoEsqueletoUI(p)}
                        estadoPausadoId={estadoPausadoId}
                        estadoReanudarId={estadoReanudarId}
                        onCambiarEstado={onCambiarEstado}
                        asignadoA={g.tecnico_id}
                        fechaPrometida={p.fecha_prometida}
                        metaExtra={null}
                        pausado={p.pausado}
                        pausaMotivo={p.pausa_motivo}
                        pausadoAt={p.pausado_at}
                        bloqueado={p.bloqueado}
                        qaChip={
                          p.qa_responsable_nombre
                            ? { nombre: p.qa_responsable_nombre, etapa: p.qa_etapa }
                            : null
                        }
                        desde={p.desde}
                        opcionesUsuario={opcionesDev}
                        saving={savingId === p.id}
                        onPatch={onPatch}
                        onVeredicto={onVeredicto}
                        onAbrir={onAbrir}
                      />
                    ))}
                  </ul>
                </section>
              ))}
          </TarjetaGrupo>
        );
      })}
    </div>
  );
}

/**
 * Los mismos proyectos activos, agrupados por asesor comercial.
 *
 * Reusa la tarjeta plegable y la fila de la vista técnica; el cambio es el eje
 * (se agrupa por quién vendió) y que la fila va en modo lectura de estado: sin
 * el contador de tiempo de trabajo, que es una métrica del equipo técnico.
 */
function ComercialSeccion({
  grupos,
  estados,
  generadoAt,
  savingId,
  abiertas,
  onToggle,
  onToggleTodas,
  todasAbiertas,
  onPatch,
  onVeredicto,
  onCambiarEstado,
  onAbrir,
}: {
  grupos: GrupoActivo[];
  estados: EstadoTableroDTO[];
  generadoAt: string | null;
  savingId: string | null;
  abiertas: Set<string>;
  onToggle: (key: string) => void;
  onToggleTodas: () => void;
  todasAbiertas: boolean;
  onPatch: (id: string, cambios: Record<string, unknown>) => void | Promise<void>;
  onVeredicto: (id: string, aprobado: boolean, motivo: string | null) => void | Promise<void>;
  onCambiarEstado: (id: string, estadoId: string) => void | Promise<void>;
  onAbrir: (id: string) => void;
}) {
  const total = grupos.reduce((n, g) => n + g.cantidad, 0);
  const opcionesEstado = estados.map((e) => ({ value: e.id, label: e.nombre }));
  const estadoPausadoId = estados.find((e) => e.codigo === "pausado")?.id ?? null;
  const estadoReanudarId = estados.find((e) => e.codigo !== "pausado")?.id ?? null;

  if (total === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
        <p className="text-sm font-medium text-slate-700">No hay proyectos en curso</p>
        <p className="mt-1 text-xs text-slate-500">
          Ningún proyecto con asesor comercial está en las columnas que sigue el equipo.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {estados.map((e) => (
            <span key={e.id} className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
              <i aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: e.color }} />
              {e.nombre}
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={onToggleTodas}
          className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
        >
          {todasAbiertas ? "Contraer todo" : "Expandir todo"}
        </button>
      </div>

      {grupos.map((g) => {
        const key = `com:${g.tecnico_id ?? "__SIN__"}`;
        const sinComercial = g.tecnico_id == null;
        const col = sinComercial
          ? { bg: "#94a3b8", soft: "rgba(148,163,184,0.14)" }
          : paleta(g.tecnico_nombre);
        return (
          <TarjetaGrupo
            key={key}
            color={col}
            inicial={sinComercial ? "—" : initials(g.tecnico_nombre)}
            titulo={sinComercial ? "Sin asignar" : nombreCorto(g.tecnico_nombre)}
            italic={sinComercial}
            subtitulo={`${g.cantidad === 1 ? "1 proyecto" : `${g.cantidad} proyectos`}${
              g.pausados > 0 ? ` · ${g.pausados} en pausa` : ""
            }`}
            contador={g.cantidad}
            abierta={abiertas.has(key)}
            onToggle={() => onToggle(key)}
            distribucion={g.secciones
              .filter((sec) => sec.proyectos.length > 0)
              .map((sec) => ({
                key: sec.estado_id,
                nombre: sec.nombre,
                cantidad: sec.cantidad,
                color: sec.color,
              }))}
          >
            {g.secciones
              .filter((sec) => sec.proyectos.length > 0)
              .map((sec) => (
                <section key={sec.estado_id} className="border-t-[6px] border-slate-100 first:border-t-0">
                  <header
                    className="flex items-center gap-2 px-4 py-2"
                    style={{ backgroundColor: `${sec.color}1A`, borderLeft: `4px solid ${sec.color}` }}
                  >
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 shrink-0 rounded-full ring-2 ring-white"
                      style={{ backgroundColor: sec.color }}
                    />
                    <h4 className="min-w-0 flex-1 truncate text-[11.5px] font-bold uppercase tracking-[0.07em] text-slate-800">
                      {sec.nombre}
                    </h4>
                    <span className="shrink-0 rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-bold tabular-nums text-slate-700">
                      {sec.cantidad}
                    </span>
                  </header>
                  <ul className="divide-y divide-slate-100" style={{ borderLeft: `4px solid ${sec.color}33` }}>
                    {sec.proyectos.map((p) => (
                      <FilaProyecto
                        key={p.id}
                        modo="comercial"
                        tecnicoNombre={p.tecnico_nombre ? nombreCorto(p.tecnico_nombre) : null}
                        id={p.id}
                        cliente={p.cliente}
                        tipo={p.tipo}
                        titulo={p.titulo}
                        etapa={p.estado_id}
                        color={p.estado_color}
                        opcionesEtapa={opcionesEstado}
                        msBase={p.ms_trabajados}
                        generadoAt={generadoAt}
                        esqueleto={p.esqueleto}
                        esqueletoTexto={textoEsqueletoUI(p)}
                        estadoPausadoId={estadoPausadoId}
                        estadoReanudarId={estadoReanudarId}
                        onCambiarEstado={onCambiarEstado}
                        asignadoA={g.tecnico_id}
                        fechaPrometida={p.fecha_prometida}
                        metaExtra={null}
                        pausado={p.pausado}
                        pausaMotivo={p.pausa_motivo}
                        pausadoAt={p.pausado_at}
                        bloqueado={p.bloqueado}
                        qaChip={
                          p.qa_responsable_nombre
                            ? { nombre: p.qa_responsable_nombre, etapa: p.qa_etapa }
                            : null
                        }
                        desde={p.desde}
                        opcionesUsuario={[]}
                        saving={savingId === p.id}
                        onPatch={onPatch}
                        onVeredicto={onVeredicto}
                        onAbrir={onAbrir}
                      />
                    ))}
                  </ul>
                </section>
              ))}
          </TarjetaGrupo>
        );
      })}
    </div>
  );
}

/**
 * Fila de proyecto, la misma para programadores y para QA. Lo único que cambia
 * es el vocabulario de etapas y a qué campo escribe el selector de responsable.
 */
function FilaProyecto({
  modo,
  tecnicoNombre,
  id,
  cliente,
  tipo,
  titulo,
  etapa,
  color,
  opcionesEtapa,
  msBase,
  generadoAt,
  esqueleto,
  esqueletoTexto,
  estadoPausadoId,
  estadoReanudarId,
  onCambiarEstado,
  asignadoA,
  fechaPrometida,
  metaExtra,
  pausado,
  pausaMotivo,
  pausadoAt,
  bloqueado,
  qaChip,
  desde,
  opcionesUsuario,
  saving,
  onPatch,
  onVeredicto,
  onAbrir,
}: {
  modo: "dev" | "qa" | "comercial";
  /** Sólo en modo comercial: quién desarrolla el proyecto (chip de lectura). */
  tecnicoNombre?: string | null;
  id: string;
  cliente: string;
  tipo: string;
  titulo: string;
  etapa: string;
  color: string;
  opcionesEtapa: { value: string; label: string; description?: string }[];
  msBase: number | null;
  generadoAt: string | null;
  esqueleto?: "ok" | "por_vencer" | "vencido" | null;
  esqueletoTexto?: string | null;
  /** Id del estado "Pausado" del tablero. `null` en las tarjetas de QA. */
  estadoPausadoId?: string | null;
  /** Estado al que vuelve un proyecto al reanudarlo (la primera columna de trabajo). */
  estadoReanudarId?: string | null;
  onCambiarEstado?: (id: string, estadoId: string) => void | Promise<void>;
  asignadoA: string | null;
  fechaPrometida: string | null;
  metaExtra: string | null;
  pausado: boolean;
  pausaMotivo: string | null;
  pausadoAt: string | null;
  bloqueado: boolean;
  qaChip: { nombre: string; etapa: ProyectoEtapaQA | null } | null;
  desde: string | null;
  opcionesUsuario: { value: string; label: string }[];
  saving: boolean;
  onPatch: (id: string, cambios: Record<string, unknown>) => void | Promise<void>;
  onVeredicto: (id: string, aprobado: boolean, motivo: string | null) => void | Promise<void>;
  onAbrir?: (id: string) => void;
}) {
  const [editandoFecha, setEditandoFecha] = useState(false);
  const [editandoPausa, setEditandoPausa] = useState(false);
  const [rechazando, setRechazando] = useState(false);
  const subtitulo = subtituloUtil({ cliente, titulo });

  /**
   * En la tarjeta de QA el selector cambia quién revisa; en la de un
   * programador, quién desarrolla.
   *
   * Mandar un proyecto a QA NO se hace desde acá: se hace poniendo la etapa en
   * "QA", que además asigna a la persona de QA. Si se pudiera elegir a la QA en
   * este selector, al no reemplazar al programador el control volvería a
   * mostrarlo y parecería que la acción no tuvo efecto.
   */
  function asignar(valor: string) {
    const campo = modo === "qa" ? "qa_responsable_id" : "responsable_tecnico_id";
    void onPatch(id, { [campo]: valor || null });
  }

  return (
    <li className={`px-4 py-3 transition-colors hover:bg-slate-50/70 ${saving ? "opacity-50" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-[11rem]">
          <a
            href={`/dashboard/proyectos/${id}`}
            onClick={(e) => abrirEnModal(e, id, onAbrir)}
            className="block cursor-pointer truncate text-[13.5px] font-semibold text-slate-800 transition-colors hover:text-[#3F8E91]"
            title={etiquetaProyecto({ cliente, tipo })}
          >
            {cliente}
            {tipo ? (
              <span className="ml-1.5 text-[12px] font-normal text-slate-400">{tipo}</span>
            ) : null}
          </a>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
            {subtitulo ? <span className="truncate">{subtitulo}</span> : null}
            {metaExtra ? <span>{metaExtra}</span> : null}
            {fechaPrometida ? <span>entrega {formatFecha(fechaPrometida)}</span> : null}
            {bloqueado ? <span className="font-semibold text-rose-600">bloqueado</span> : null}
            {esqueletoTexto ? (
              <span
                className={`inline-flex animate-pulse items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold ${
                  esqueleto === "vencido"
                    ? "bg-rose-100 text-rose-700"
                    : "bg-amber-100 text-amber-800"
                }`}
                title="Compromiso de entrega del esqueleto de un Proyecto Web: 48 h corridas sin contar domingos"
              >
                {esqueletoTexto}
              </span>
            ) : null}
            {/*
              Sólo queda el chip de QA aprobada, que es un BOTÓN: es la única
              puerta para volver a mandar el proyecto a revisión.

              El chip informativo "QA · <etapa>" se quitó: la fila ya vive
              dentro de una subsección que dice el estado y al lado tiene el
              selector con la etapa, así que repetía lo mismo dos veces.
            */}
            {qaChip ? (
              qaChip.etapa === "finalizado" ? (
                // Ciclo de QA cerrado: el proyecto ya no está en la tarjeta de
                // QA, así que este chip es la única puerta para volver a abrirlo.
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void onPatch(id, { qa_etapa: "revision_pre_entrega" })}
                  title={`QA aprobada por ${qaChip.nombre} — clic para volver a mandarlo a revisión`}
                  className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  QA ✓ · reabrir
                </button>
              ) : null
            ) : null}
          </div>
        </div>

        {/*
          El comercial mira en qué estado va cada proyecto que vendió, no cuánto
          tiempo lleva trabajándolo el técnico: ese contador es una métrica del
          equipo técnico y acá sería ruido.
        */}
        {modo === "comercial" ? null : (
        <ContadorVivo
          msBase={msBase}
          generadoAt={generadoAt}
          esqueleto={esqueleto}
          asignado={asignadoA != null}
          pausado={pausado}
          activo={editandoFecha}
          onClick={modo === "dev" ? () => setEditandoFecha((v) => !v) : undefined}
          titulo={modo === "qa" ? "Tiempo de trabajo desde que se le asignó la revisión" : undefined}
        />
        )}

        <FancySelect
          size="sm"
          className="w-[10.5rem] shrink-0"
          ariaLabel={modo === "qa" ? "Etapa de QA" : "Etapa de desarrollo"}
          disabled={saving}
          options={opcionesEtapa}
          value={etapa}
          onChange={(v) => {
            // Tarjeta de programador: el selector mueve el estado del Kanban,
            // que es el mismo eje que ve comercial. Elegir "Pausado" pide antes
            // el motivo, porque es lo que después se lee en el tablero.
            if (modo === "dev" || modo === "comercial") {
              if (v === estadoPausadoId) {
                setEditandoPausa(true);
                return;
              }
              void onCambiarEstado?.(id, v);
              return;
            }
            // En la tarjeta de QA, dos de las tres etapas SON el veredicto:
            // "Finalizado" es aprobar y "Cambios" es rechazar. Van por la ruta
            // del veredicto y no por un PATCH, que movería la etapa sin avisarle
            // a nadie — que es justo lo que hay que evitar acá.
            if (modo === "qa" && v === "finalizado") {
              void onVeredicto(id, true, null);
              return;
            }
            if (modo === "qa" && v === "cambios") {
              setRechazando(true);
              return;
            }
            const campo = modo === "qa" ? "qa_etapa" : "etapa_desarrollo";
            // Elegir una etapa real reanuda: la pausa no es un estado paralelo.
            void onPatch(id, pausado ? { [campo]: v, pausado: false } : { [campo]: v });
          }}
          triggerStyle={{ backgroundColor: `${color}12`, borderColor: `${color}55`, color }}
        />

        {/*
          En la vista comercial la tarjeta agrupa por asesor, así que este
          selector mostraría una lista de técnicos contra el id de un comercial:
          no coincide, y editarlo reasignaría al técnico desde una pantalla de
          lectura. Se reemplaza por quién lo está desarrollando, que es lo que
          el comercial necesita saber.
        */}
        {modo === "comercial" ? (
          <span
            className="w-[9.5rem] shrink-0 truncate rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[12px] text-slate-600"
            title={tecnicoNombre ? `Desarrolla ${tecnicoNombre}` : "Sin técnico asignado"}
          >
            {tecnicoNombre ?? <span className="italic text-slate-400">Sin técnico</span>}
          </span>
        ) : (
          <FancySelect
            size="sm"
            className="w-[9.5rem] shrink-0"
            ariaLabel="Responsable"
            placeholder="Sin asignar"
            disabled={saving || opcionesUsuario.length <= 1}
            options={opcionesUsuario}
            value={asignadoA ?? ""}
            onChange={asignar}
          />
        )}
      </div>

      {pausado && !editandoPausa ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2">
          <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-amber-700">
            <IconPause />
            Pausado
          </span>
          <span className="min-w-0 flex-1 break-words text-[11px] text-amber-900">
            {pausaMotivo || "sin motivo cargado"}
          </span>
          {pausadoAt ? (
            <span className="text-[10px] text-amber-600">desde {formatDiaMes(pausadoAt)}</span>
          ) : null}
          <button
            type="button"
            onClick={() => setEditandoPausa(true)}
            className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 transition-colors hover:bg-amber-100"
          >
            Editar
          </button>
          <button
            type="button"
            onClick={() => {
              // Reanudar es sacarlo de la columna Pausado: si sólo limpiáramos
              // la marca de pausa el proyecto seguiría figurando "Pausado" en el
              // Kanban, que ahora es el mismo eje.
              if (modo !== "qa" && estadoReanudarId) void onCambiarEstado?.(id, estadoReanudarId);
              else void onPatch(id, { pausado: false });
            }}
            className="rounded-md bg-white px-2 py-0.5 text-[11px] font-semibold text-emerald-700 shadow-sm ring-1 ring-emerald-200 transition-colors hover:bg-emerald-50"
          >
            Reanudar
          </button>
        </div>
      ) : null}

      {editandoPausa ? (
        <MotivoForm
          motivoActual={pausaMotivo}
          etiqueta="Motivo de la pausa"
          placeholder="Ej: esperando contenido del cliente"
          ayuda="Se ve en el tablero y va en el mensaje de WhatsApp. El contador de días se congela."
          textoBoton="Pausar"
          tono="amber"
          icono={<IconPause />}
          onCancel={() => setEditandoPausa(false)}
          onSubmit={(motivo) => {
            setEditandoPausa(false);
            if (modo !== "qa" && estadoPausadoId) {
              // Ya está en la columna Pausado (se está editando el motivo): sólo
              // se guarda el texto. Mover al mismo estado no haría nada y
              // gastaría un request de más.
              if (pausado) {
                void onPatch(id, { pausa_motivo: motivo });
                return;
              }
              // Primero el estado (abre la pausa y congela el contador) y
              // después el motivo, que es un dato del proyecto y no del estado.
              void Promise.resolve(onCambiarEstado?.(id, estadoPausadoId)).then(() =>
                onPatch(id, { pausa_motivo: motivo })
              );
              return;
            }
            void onPatch(id, { pausado: true, pausa_motivo: motivo });
          }}
        />
      ) : null}

      {rechazando ? (
        <MotivoForm
          motivoActual={null}
          etiqueta="Motivo del rechazo"
          placeholder="Ej: el checkout no valida el cupón vencido"
          ayuda="Le llega al programador en la notificación."
          textoBoton="Rechazar"
          tono="rose"
          onCancel={() => setRechazando(false)}
          onSubmit={(motivo) => {
            setRechazando(false);
            void onVeredicto(id, false, motivo);
          }}
        />
      ) : null}

      {editandoFecha ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <span className="text-[11px] font-medium text-slate-600">Asignado el</span>
          <FechaSelect
            defaultValue={isoADateInput(desde)}
            max={isoADateInput(new Date().toISOString())}
            onChange={(e) => {
              if (!e.target.value) return;
              void onPatch(id, {
                tecnico_asignado_at: new Date(`${e.target.value}T00:00:00`).toISOString(),
              });
              setEditandoFecha(false);
            }}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
/>
          <span className="text-[11px] text-slate-400">
            Corregí la fecha si el contador arrancó desde la creación del proyecto.
          </span>
          <button
            type="button"
            onClick={() => setEditandoFecha(false)}
            className="ml-auto text-[11px] font-medium text-slate-500 transition-colors hover:text-slate-700"
          >
            Cancelar
          </button>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Editor de un motivo obligatorio. Lo usan la pausa y el rechazo de QA: en los
 * dos casos el texto es lo único que le explica al resto del equipo qué pasó,
 * y en los dos viaja fuera del tablero (WhatsApp en uno, la notificación en el
 * otro), así que dejarlo opcional lo vaciaría de sentido.
 */
function MotivoForm({
  motivoActual,
  etiqueta,
  placeholder,
  ayuda,
  textoBoton,
  tono,
  icono,
  onSubmit,
  onCancel,
}: {
  motivoActual: string | null;
  etiqueta: string;
  placeholder: string;
  ayuda: string;
  textoBoton: string;
  tono: "amber" | "rose";
  icono?: React.ReactNode;
  onSubmit: (motivo: string) => void;
  onCancel: () => void;
}) {
  const [motivo, setMotivo] = useState(motivoActual ?? "");

  const t =
    tono === "rose"
      ? {
          caja: "border-rose-200 bg-rose-50/70",
          texto: "text-rose-700",
          input: "border-rose-200 focus:border-rose-400 focus:ring-rose-200",
          boton: "bg-rose-600 hover:bg-rose-700 disabled:bg-rose-200",
        }
      : {
          caja: "border-amber-200 bg-amber-50/70",
          texto: "text-amber-700",
          input: "border-amber-200 focus:border-amber-400 focus:ring-amber-200",
          boton: "bg-amber-500 hover:bg-amber-600 disabled:bg-amber-200",
        };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const limpio = motivo.trim();
        if (limpio) onSubmit(limpio);
      }}
      className={`mt-2.5 space-y-2 rounded-lg border px-3 py-2.5 ${t.caja}`}
    >
      <label className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide ${t.texto}`}>
        {icono}
        {etiqueta}
      </label>
      <input
        autoFocus
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-lg border bg-white px-3 py-1.5 text-[12px] text-slate-800 outline-none placeholder:text-slate-400 focus:ring-2 ${t.input}`}
      />
      <div className="flex items-center gap-2">
        <span className={`text-[10px] ${t.texto}`}>{ayuda}</span>
        <button
          type="button"
          onClick={onCancel}
          className="ml-auto rounded-md px-2 py-1 text-[11px] font-semibold text-slate-500 transition-colors hover:text-slate-700"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={!motivo.trim()}
          className={`rounded-md px-3 py-1 text-[11px] font-semibold text-white shadow-sm transition-colors disabled:cursor-not-allowed ${t.boton}`}
        >
          {textoBoton}
        </button>
      </div>
    </form>
  );
}

/**
 * Un solo temporizador para todo el tablero.
 *
 * Cada fila necesita repintarse una vez por segundo, pero montar un `setInterval`
 * por proyecto haría decenas de timers compitiendo. Este hook mantiene uno solo
 * y devuelve el instante actual; todas las filas se repintan en el mismo tick,
 * que además es lo que hace que los segundos avancen sincronizados.
 */
function useSegundero(activo: boolean): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    if (!activo) return;
    const id = window.setInterval(() => setAhora(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [activo]);
  return ahora;
}

/**
 * Contador de trabajo del proyecto: días, horas, minutos y segundos de HORARIO
 * LABORAL desde que el proyecto quedó en manos del técnico.
 *
 * El valor base lo calcula la API; acá sólo se le suma el horario laboral
 * transcurrido desde que se generó la respuesta. Fuera de hora —de noche, un
 * domingo— ese incremento da cero y el contador se queda quieto solo, sin
 * ninguna lógica especial.
 *
 * Un proyecto pausado congela en el valor base: los días están detenidos, no
 * atrasados.
 */
function ContadorVivo({
  msBase,
  generadoAt,
  asignado,
  pausado,
  esqueleto,
  activo,
  onClick,
  titulo,
}: {
  msBase: number | null;
  generadoAt: string | null;
  asignado: boolean;
  pausado: boolean;
  esqueleto?: "ok" | "por_vencer" | "vencido" | null;
  activo: boolean;
  onClick?: () => void;
  titulo?: string;
}) {
  const ahora = useSegundero(!pausado && msBase != null);

  if (!asignado || msBase == null) {
    return (
      <span
        className="inline-flex min-w-[6.5rem] items-center justify-center rounded-lg border border-dashed border-slate-200 px-2 py-1.5 text-[11px] font-medium text-slate-300"
        title={
          asignado
            ? "Sin fecha de asignación"
            : "El contador arranca cuando se le asigna el proyecto a un programador"
        }
      >
        —
      </span>
    );
  }

  const transcurrido = pausado
    ? 0
    : msLaborables(generadoAt, new Date(ahora).toISOString()) ?? 0;
  const ms = msBase + transcurrido;
  const jornadas = enJornadas(ms);

  // El aviso de esqueleto manda sobre el color de antigüedad: es un compromiso
  // con fecha, no una señal de que el proyecto viene lento.
  const alerta = esqueleto === "vencido" || esqueleto === "por_vencer";
  const tono = pausado
    ? "border-amber-200 bg-amber-50 text-amber-700"
    : esqueleto === "vencido"
      ? "border-rose-300 bg-rose-50 text-rose-700"
      : esqueleto === "por_vencer"
        ? "border-amber-300 bg-amber-50 text-amber-800"
        : ms >= 30 * MS_JORNADA_UI
          ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
          : ms >= 14 * MS_JORNADA_UI
            ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
            : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100";

  const title =
    titulo ??
    (pausado
      ? "Tiempo trabajado — congelado mientras el proyecto está pausado"
      : `Tiempo de trabajo (lun–vie 8–17, sáb 8–12)${
          jornadas != null ? ` · ${jornadas} jornadas` : ""
        } — clic para corregir la fecha de inicio`);

  const clases = `inline-flex min-w-[6.5rem] items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-bold tabular-nums transition-colors ${tono} ${
    activo ? "ring-2 ring-[#4FAEB2]/30" : ""
  } ${alerta && !pausado ? "animate-pulse" : ""}`;

  const contenido = (
    <>
      {pausado ? <IconPause /> : null}
      {formatearDuracion(ms)}
    </>
  );

  if (!onClick) {
    return (
      <span className={clases} title={title}>
        {contenido}
      </span>
    );
  }

  return (
    <button type="button" onClick={onClick} aria-expanded={activo} title={title} className={clases}>
      {contenido}
    </button>
  );
}

/** Jornada de 9 h: la unidad con la que se colorea la antigüedad del contador. */
const MS_JORNADA_UI = 9 * 3_600_000;

/** Cuántos finalizados se muestran por tarjeta antes de tener que desplegar. */
const FINALIZADOS_VISIBLES = 5;

function FinalizadosSeccion({
  data,
  mes,
  onAbrir,
}: {
  data: TareasEquipoData | null;
  mes: string;
  onAbrir: (id: string) => void;
}) {
  const [busqueda, setBusqueda] = useState("");
  /** Tarjetas donde el usuario pidió ver todos, más allá de los primeros 5. */
  const [desplegados, setDesplegados] = useState<Set<string>>(new Set());
  /** Tarjetas de persona abiertas (mismo acordeón que la vista "En curso"). */
  const [abiertas, setAbiertas] = useState<Set<string>>(() => new Set());
  const toggleAbierta = (key: string) =>
    setAbiertas((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const grupos = useMemo(() => data?.finalizados_por_programador ?? [], [data]);
  const tokens = useMemo(() => tokenizarBusqueda(busqueda), [busqueda]);

  /**
   * Grupos filtrados y ordenados por fecha de finalización descendente: los
   * "últimos 5" son los más recientes, no los primeros que devolvió la API.
   * El nombre del técnico entra en el texto buscable, que es lo que permite
   * filtrar por persona escribiéndola.
   */
  const visibles = useMemo(() => {
    return grupos
      .map((g) => {
        const proyectos = g.proyectos
          .filter((p) =>
            coincideBusqueda(tokens, `${p.cliente} ${p.titulo} ${p.tipo} ${g.tecnico_nombre}`)
          )
          .slice()
          .sort((a, b) => (b.finalizado_at ?? "").localeCompare(a.finalizado_at ?? ""));
        return { ...g, proyectos };
      })
      .filter((g) => g.proyectos.length > 0);
  }, [grupos, tokens]);

  const totalEncontrados = visibles.reduce((n, g) => n + g.proyectos.length, 0);
  const buscando = tokens.length > 0;

  if (grupos.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
        <p className="text-sm font-medium text-slate-700">Sin proyectos finalizados</p>
        <p className="mt-1 text-xs text-slate-500">
          Ningún proyecto pasó a etapa “Finalizado” en {formatMesLargo(mes)}.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <IconBuscar />
          </span>
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por cliente, tipo o técnico…"
            aria-label="Buscar entre los proyectos finalizados"
            className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-700 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
          />
        </div>
        {buscando ? (
          <span className="text-xs text-slate-500">
            {totalEncontrados === 0
              ? "Sin coincidencias"
              : `${totalEncontrados} ${totalEncontrados === 1 ? "proyecto" : "proyectos"} · ${
                  visibles.length
                } ${visibles.length === 1 ? "técnico" : "técnicos"}`}
          </span>
        ) : null}
      </div>

      {visibles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-sm font-medium text-slate-700">Sin coincidencias</p>
          <p className="mt-1 text-xs text-slate-500">
            Ningún finalizado de {formatMesLargo(mes)} coincide con “{busqueda.trim()}”.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {visibles.map((g) => {
            const key = g.tecnico_id ?? "__SIN__";
            const sinTecnico = g.tecnico_id == null;
            const col = sinTecnico ? { bg: "#94a3b8", soft: "rgba(148,163,184,0.10)" } : paleta(g.tecnico_nombre);
            // Buscando se muestran todas las coincidencias: recortar a 5 justo
            // cuando alguien busca algo puntual sería esconder el resultado.
            const desplegado = buscando || desplegados.has(key);
            const mostrados = desplegado ? g.proyectos : g.proyectos.slice(0, FINALIZADOS_VISIBLES);
            const ocultos = g.proyectos.length - mostrados.length;
            const puedePlegar = desplegado && !buscando && g.proyectos.length > FINALIZADOS_VISIBLES;
            return (
              <TarjetaGrupo
                key={key}
                color={col}
                inicial={sinTecnico ? "—" : initials(g.tecnico_nombre)}
                titulo={sinTecnico ? "Sin asignar" : nombreCorto(g.tecnico_nombre)}
                italic={sinTecnico}
                subtitulo={`${g.cantidad === 1 ? "1 finalizado" : `${g.cantidad} finalizados`}${
                  g.promedio_ms != null ? ` · promedio ${enJornadas(g.promedio_ms)} jornadas` : ""
                }`}
                contador={g.cantidad}
                // Los finalizados no viven en columnas del tablero: la barra de
                // distribución no aplica y se deja vacía.
                distribucion={[]}
                // Buscando, las coincidencias se muestran abiertas: si no, el
                // resultado quedaría escondido detrás de un clic.
                abierta={buscando || abiertas.has(key)}
                onToggle={() => toggleAbierta(key)}
              >
                <ul className="divide-y divide-slate-100">
                  {mostrados.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <a
                          href={`/dashboard/proyectos/${p.id}`}
                          onClick={(e) => abrirEnModal(e, p.id, onAbrir)}
                          className="block cursor-pointer truncate text-[13px] font-semibold text-slate-800 transition-colors hover:text-[#3F8E91]"
                          title={etiquetaProyecto(p)}
                        >
                          {p.cliente}
                          {p.tipo ? <span className="ml-1.5 font-normal text-slate-400">{p.tipo}</span> : null}
                        </a>
                        <div className="truncate text-[11px] text-slate-500">
                          Finalizado el {formatFecha(p.finalizado_at)}
                        </div>
                      </div>
                      <span
                        className="shrink-0 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-bold tabular-nums text-emerald-700"
                        title="Tiempo de trabajo desde la asignación hasta finalizar, en horario laboral y sin contar pausas"
                      >
                        {formatearDuracion(p.ms_trabajados)}
                      </span>
                    </li>
                  ))}
                </ul>

                {ocultos > 0 || puedePlegar ? (
                  <button
                    type="button"
                    onClick={() =>
                      setDesplegados((prev) => {
                        const next = new Set(prev);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                    className="w-full border-t border-slate-100 px-4 py-2 text-[11px] font-semibold text-[#3F8E91] transition-colors hover:bg-slate-50"
                  >
                    {ocultos > 0 ? `Ver ${ocultos} más` : `Ver sólo los últimos ${FINALIZADOS_VISIBLES}`}
                  </button>
                ) : null}
              </TarjetaGrupo>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* --- Íconos ------------------------------------------------------------- */

const SVG_PROPS = {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: "h-3.5 w-3.5",
  "aria-hidden": true,
};

function IconBuscar() {
  return (
    <svg {...SVG_PROPS}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function IconCopy() {
  return (
    <svg {...SVG_PROPS}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg {...SVG_PROPS}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconChevronLeft() {
  return (
    <svg {...SVG_PROPS}>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function IconChevronRight() {
  return (
    <svg {...SVG_PROPS}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function IconPause() {
  return (
    <svg {...SVG_PROPS} className="h-3 w-3">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg {...SVG_PROPS} className="h-3 w-3">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  );
}
