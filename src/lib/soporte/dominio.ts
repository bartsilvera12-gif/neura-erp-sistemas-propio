/**
 * Dominio del módulo Soporte: tipos, catálogos por defecto, flujo y SLA.
 *
 * Módulo isomórfico: lo importan las rutas de API y las pantallas. No puede
 * tocar la base ni depender de nada de servidor.
 *
 * Soporte es un dominio propio. Reusa el reloj laboral de Proyectos (que es la
 * forma oficial de medir tiempo de trabajo en el ERP) pero no depende de
 * proyectos ni de observaciones de QA.
 */

import { TZ_OFFSET_MIN, msLaborables, sumarMsLaborables } from "@/lib/proyectos/reloj-laboral";

// ---------------------------------------------------------------- catálogos

export type SoporteEstado = {
  codigo: string;
  nombre: string;
  tipo: "abierto" | "cerrado";
  color: string;
  area: string | null;
  detiene_sla: boolean;
  es_inicial: boolean;
  sort_order: number;
  activo: boolean;
};

export type SoporteTipo = {
  codigo: string;
  nombre: string;
  sla_horas: number | null;
  sort_order: number;
  activo: boolean;
};

export type SoporteClasificacion = {
  codigo: string;
  tipo_codigo: string;
  nombre: string;
  sla_horas: number;
  prioridad_sugerida: string | null;
  sort_order: number;
  activo: boolean;
};

export type SoportePrioridad = {
  codigo: string;
  nombre: string;
  color: string;
  sort_order: number;
  activo: boolean;
};

export type CatalogosSoporte = {
  estados: SoporteEstado[];
  tipos: SoporteTipo[];
  clasificaciones: SoporteClasificacion[];
  prioridades: SoportePrioridad[];
};

/**
 * Estados del flujo de Gestión de Soporte de Neura.
 *
 * `area` es quién suele tener la acción en ese estado. "Re-abierto" es el
 * estado al que vuelve un ticket cuando QA pide cambios en la revisión.
 */
export const ESTADOS_DEFECTO: SoporteEstado[] = [
  { codigo: "pendiente", nombre: "Pendiente", tipo: "abierto", color: "#94a3b8", area: "ATC / PM", detiene_sla: false, es_inicial: true, sort_order: 1, activo: true },
  { codigo: "en_proceso", nombre: "En proceso", tipo: "abierto", color: "#0ea5e9", area: "Desarrollo", detiene_sla: false, es_inicial: false, sort_order: 2, activo: true },
  { codigo: "falta_informacion", nombre: "Falta información", tipo: "abierto", color: "#f59e0b", area: "ATC / PM", detiene_sla: false, es_inicial: false, sort_order: 3, activo: true },
  { codigo: "listo_revision", nombre: "Listo para revisión", tipo: "abierto", color: "#8b5cf6", area: "QA", detiene_sla: false, es_inicial: false, sort_order: 4, activo: true },
  { codigo: "reabierto", nombre: "Re-abierto", tipo: "abierto", color: "#f97316", area: "Desarrollo", detiene_sla: false, es_inicial: false, sort_order: 5, activo: true },
  { codigo: "resuelto", nombre: "Resuelto", tipo: "cerrado", color: "#10b981", area: "ATC / PM", detiene_sla: true, es_inicial: false, sort_order: 6, activo: true },
  { codigo: "cancelado", nombre: "Cancelado", tipo: "cerrado", color: "#f43f5e", area: null, detiene_sla: true, es_inicial: false, sort_order: 7, activo: true },
  { codigo: "cerrado", nombre: "Cerrado", tipo: "cerrado", color: "#334155", area: null, detiene_sla: true, es_inicial: false, sort_order: 8, activo: true },
];

export const TIPOS_DEFECTO: SoporteTipo[] = [
  { codigo: "error", nombre: "Error", sla_horas: null, sort_order: 1, activo: true },
  { codigo: "cambio", nombre: "Cambio", sla_horas: null, sort_order: 2, activo: true },
  { codigo: "consulta", nombre: "Consulta", sla_horas: null, sort_order: 3, activo: true },
  { codigo: "capacitacion", nombre: "Capacitación", sla_horas: null, sort_order: 4, activo: true },
  { codigo: "otro", nombre: "Otros", sla_horas: null, sort_order: 5, activo: true },
];

/** Service levels del proceso oficial. */
export const CLASIFICACIONES_DEFECTO: SoporteClasificacion[] = [
  { codigo: "error_bajo", tipo_codigo: "error", nombre: "Bajo", sla_horas: 8, prioridad_sugerida: "normal", sort_order: 1, activo: true },
  { codigo: "error_medio", tipo_codigo: "error", nombre: "Medio", sla_horas: 5, prioridad_sugerida: "alta", sort_order: 2, activo: true },
  { codigo: "error_alto", tipo_codigo: "error", nombre: "Alto / Urgente", sla_horas: 2, prioridad_sugerida: "urgente", sort_order: 3, activo: true },
  { codigo: "cambio_estetico", tipo_codigo: "cambio", nombre: "Cambio estético", sla_horas: 5, prioridad_sugerida: "normal", sort_order: 4, activo: true },
  { codigo: "cambio_funcional", tipo_codigo: "cambio", nombre: "Cambio funcional", sla_horas: 48, prioridad_sugerida: "normal", sort_order: 5, activo: true },
];

export const PRIORIDADES_DEFECTO: SoportePrioridad[] = [
  { codigo: "baja", nombre: "Baja", color: "#94a3b8", sort_order: 1, activo: true },
  { codigo: "normal", nombre: "Normal", color: "#64748b", sort_order: 2, activo: true },
  { codigo: "alta", nombre: "Alta", color: "#f59e0b", sort_order: 3, activo: true },
  { codigo: "urgente", nombre: "Urgente", color: "#ef4444", sort_order: 4, activo: true },
];

// -------------------------------------------------------------------- flujo

/**
 * Transiciones del flujo:
 *
 *   Pendiente → En proceso · Falta información · Cancelado
 *   En proceso → Cancelado · Falta información · Listo para revisión
 *   Falta información → En proceso · Cancelado
 *   Listo para revisión → Resuelto (con las subtareas finalizadas)
 *     · a Re-abierto lo lleva QA al pedir cambios en la subtarea, no a mano
 *   Re-abierto → En proceso · Falta información · Cancelado
 *   Resuelto → Re-abierto · Cerrado
 *   Cancelado y Cerrado son finales.
 *
 * Un estado creado desde Configuración no tiene reglas propias: se permite
 * moverse libremente desde y hacia él, en vez de dejar el ticket trabado.
 */
export const TRANSICIONES: Record<string, string[]> = {
  pendiente: ["en_proceso", "falta_informacion", "cancelado"],
  en_proceso: ["cancelado", "falta_informacion", "listo_revision"],
  falta_informacion: ["en_proceso", "cancelado"],
  listo_revision: ["resuelto"],
  reabierto: ["en_proceso", "falta_informacion", "cancelado"],
  resuelto: ["reabierto", "cerrado"],
  cancelado: [],
  cerrado: [],
};

/** Número visible del ticket, con cuatro dígitos: 1 → "#0001". */
export function numeroTicket(numero: number | string | null | undefined): string {
  const n = Number(numero);
  return Number.isFinite(n) && n > 0 ? `#${String(Math.trunc(n)).padStart(4, "0")}` : "#—";
}

/** Mensaje de un estado final: desde acá ya no hay cambios de estado. */
export function mensajeEstadoFinal(ticket: { numero: number; estado_codigo: string }, nombreEstado: string): string | null {
  const reglas = TRANSICIONES[ticket.estado_codigo];
  if (!reglas || reglas.length > 0) return null;
  return `Error, Ticket ${numeroTicket(ticket.numero)} ${nombreEstado}: ya no pueden realizarse cambios de estado`;
}

/** Cierre de la franja de guardia: 20:00, hora de Paraguay. */
const FIN_GUARDIA_MIN = 20 * 60;

/**
 * ¿Está activa la guardia? (Proceso de Gestión de Soporte v1.4, §11.1)
 *
 * Se activa cuando termina la jornada y cubre hasta las 20:00: lunes a viernes
 * de 17 a 20, sábados de 12 a 20 y domingos de 8 a 20. Antes de las 8 y después
 * de las 20 no hay guardia: rige el proceso ordinario.
 */
export function enFranjaDeGuardia(ahora: number = Date.now()): boolean {
  const local = new Date(ahora + TZ_OFFSET_MIN * 60_000);
  const dia = local.getUTCDay(); // 0 = domingo
  const minuto = local.getUTCHours() * 60 + local.getUTCMinutes();
  // Domingo no hay jornada: la guardia cubre de 8 a 20.
  const finJornada = dia === 0 ? 8 * 60 : dia === 6 ? 12 * 60 : 17 * 60;
  return minuto >= finJornada && minuto < FIN_GUARDIA_MIN;
}

/** Estados a los que no se puede pasar con subtareas sin finalizar. */
export const ESTADOS_EXIGEN_SUBTAREAS_FINALIZADAS = ["resuelto", "cerrado"];

/**
 * En horario de guardia no hay QA: un ticket en proceso (o reabierto) puede
 * pasar directo a Resuelto, sin "Listo para revisión".
 */
export const ESTADOS_RESOLUBLES_EN_GUARDIA = ["en_proceso", "reabierto"];

export function transicionPermitida(desde: string, hacia: string, opciones: { guardia?: boolean } = {}): boolean {
  if (desde === hacia) return false;
  if (opciones.guardia && hacia === "resuelto" && ESTADOS_RESOLUBLES_EN_GUARDIA.includes(desde)) return true;
  const reglas = TRANSICIONES[desde];
  if (!reglas) return true;
  if (!(hacia in TRANSICIONES)) return true;
  return reglas.includes(hacia);
}

/**
 * El evento de historial que corresponde a un cambio de estado.
 *
 * Además del genérico "cambio_estado", los hitos de QA y el cierre tienen su
 * propio nombre: son los que se cuentan en reportes (devoluciones de QA,
 * confirmaciones), y buscarlos por par de estados sería frágil.
 */
export function eventoDeTransicion(desde: string, hacia: string): string {
  if (hacia === "listo_revision") return "entrega_qa";
  if (desde === "listo_revision" && hacia === "reabierto") return "devolucion_qa";
  if (desde === "listo_revision" && hacia === "resuelto") return "confirmacion_qa";
  if (hacia === "resuelto" && ESTADOS_RESOLUBLES_EN_GUARDIA.includes(desde)) return "resuelto_guardia";
  if (hacia === "cerrado") return "cierre";
  if (hacia === "cancelado") return "cancelacion";
  if (hacia === "reabierto") return "reapertura";
  return "cambio_estado";
}

// --------------------------------------------------------------- subtareas

export type EstadoSubtarea = "pendiente" | "en_proceso" | "cambios_solicitados" | "finalizado";

export const ESTADOS_SUBTAREA: { codigo: EstadoSubtarea; nombre: string; color: string }[] = [
  { codigo: "pendiente", nombre: "Pendiente", color: "#94a3b8" },
  { codigo: "en_proceso", nombre: "En proceso", color: "#0ea5e9" },
  { codigo: "cambios_solicitados", nombre: "Cambios solicitados", color: "#f97316" },
  { codigo: "finalizado", nombre: "Finalizado", color: "#10b981" },
];

/**
 * Pasos de una subtarea de revisión. "Cambios solicitados" espera a Desarrollo:
 * cuando el ticket vuelve a "Listo para revisión" la MISMA subtarea vuelve a
 * Pendiente (no se abre otra), y QA la revisa de nuevo hasta finalizarla.
 */
export const TRANSICIONES_SUBTAREA: Record<EstadoSubtarea, EstadoSubtarea[]> = {
  pendiente: ["en_proceso", "cambios_solicitados", "finalizado"],
  en_proceso: ["cambios_solicitados", "finalizado"],
  cambios_solicitados: [],
  finalizado: [],
};

/**
 * Una subtarea está abierta mientras QA la tiene en mano (Pendiente o En
 * proceso). "Cambios solicitados" cierra esa ronda de revisión: el ticket vuelve
 * a Re-abierto y, en la próxima entrega, se abre una revisión nueva que QA tiene
 * que finalizar antes de pasar el ticket a Resuelto.
 */
export function subtareaAbierta(estado: string): boolean {
  return estado === "pendiente" || estado === "en_proceso";
}

export function nombreEstadoSubtarea(codigo: string): string {
  return ESTADOS_SUBTAREA.find((e) => e.codigo === codigo)?.nombre ?? codigo;
}

/** Quién puede quedar a cargo de un ticket: por ahora, Desarrollo y QA. */
export function puedeEstarACargo(p: { es_tecnico?: boolean | null; es_qa?: boolean | null }): boolean {
  return p.es_tecnico === true || p.es_qa === true;
}

/** Un estado abierto que no es el inicial necesita a alguien con la próxima acción. */
export function requiereResponsable(estado: SoporteEstado | undefined): boolean {
  if (!estado) return false;
  return estado.tipo === "abierto" && !estado.es_inicial;
}

// ---------------------------------------------------------------------- SLA

export type EstadoSla = "sin_sla" | "en_tiempo" | "en_riesgo" | "vencido" | "cumplido" | "incumplido";

export type InfoSla = {
  estado: EstadoSla;
  /** Tiempo laboral transcurrido. */
  transcurridoMs: number;
  objetivoMs: number | null;
  /** 0..1+ (puede pasar de 1 cuando está vencido). */
  proporcion: number | null;
};

const HORA_MS = 3_600_000;

/** Umbral a partir del cual un SLA en curso se marca "en riesgo". */
export const SLA_UMBRAL_RIESGO = 0.75;

/**
 * Estado del SLA de un ticket.
 *
 * El tiempo se mide con el reloj LABORAL del ERP (lun–vie 8–17, sáb 8–12), el
 * mismo que usa Proyectos: un error "de 2 horas" reportado un viernes a las 16
 * no vence el sábado a la madrugada. Corre desde la creación hasta que el ticket
 * entra a un estado que detiene el SLA (resuelto), o hasta ahora.
 */
export function calcularSla(
  t: { created_at: string; sla_horas: number | string | null; resuelto_at: string | null },
  ahoraIso: string = new Date().toISOString()
): InfoSla {
  const horas = t.sla_horas == null ? null : Number(t.sla_horas);
  const hasta = t.resuelto_at ?? ahoraIso;
  const transcurridoMs = Math.max(0, msLaborables(t.created_at, hasta) ?? 0);
  if (horas == null || !Number.isFinite(horas) || horas <= 0) {
    return { estado: "sin_sla", transcurridoMs, objetivoMs: null, proporcion: null };
  }
  const objetivoMs = horas * HORA_MS;
  const proporcion = transcurridoMs / objetivoMs;
  let estado: EstadoSla;
  if (t.resuelto_at) estado = proporcion <= 1 ? "cumplido" : "incumplido";
  else if (proporcion > 1) estado = "vencido";
  else if (proporcion >= SLA_UMBRAL_RIESGO) estado = "en_riesgo";
  else estado = "en_tiempo";
  return { estado, transcurridoMs, objetivoMs, proporcion };
}

// ------------------------------------------------------------ fecha objetivo

/**
 * Cuándo vence un ticket: `horas` de horario laboral contadas desde `desdeIso`.
 * Es la fecha objetivo automática de los errores (2, 5 u 8 h según el nivel).
 */
export function vencimientoSla(desdeIso: string | number, horas: number | null | undefined): string | null {
  if (horas == null || !Number.isFinite(Number(horas)) || Number(horas) <= 0) return null;
  const desde = typeof desdeIso === "number" ? desdeIso : Date.parse(desdeIso);
  if (!Number.isFinite(desde)) return null;
  return new Date(sumarMsLaborables(desde, Number(horas) * HORA_MS)).toISOString();
}

const OFFSET_PY = `${TZ_OFFSET_MIN <= 0 ? "-" : "+"}${String(Math.floor(Math.abs(TZ_OFFSET_MIN) / 60)).padStart(2, "0")}:${String(Math.abs(TZ_OFFSET_MIN) % 60).padStart(2, "0")}`;

/**
 * Fecha objetivo que llega de un formulario, a ISO. Acepta la del selector
 * (`YYYY-MM-DDTHH:mm`, hora de Paraguay), una fecha sola (vence a las 17:00) o
 * un ISO completo. `undefined` si no se puede leer.
 */
export function fechaObjetivoAIso(v: string): string | undefined {
  const t = v.trim();
  let candidato: string;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t)) candidato = `${t}:00${OFFSET_PY}`;
  else if (/^\d{4}-\d{2}-\d{2}$/.test(t)) candidato = `${t}T17:00:00${OFFSET_PY}`;
  else candidato = t;
  const ms = Date.parse(candidato);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

/** ISO → `YYYY-MM-DDTHH:mm` en hora de Paraguay, para el selector de fecha y hora. */
export function isoAFechaHoraLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + TZ_OFFSET_MIN * 60_000).toISOString().slice(0, 16);
}

/** "18/09/2026 09:00" en hora de Paraguay, sin depender del navegador. */
export function fechaHoraPy(iso: string | null | undefined): string {
  const l = isoAFechaHoraLocal(iso);
  if (!l) return "—";
  return `${l.slice(8, 10)}/${l.slice(5, 7)}/${l.slice(0, 4)} ${l.slice(11, 16)}`;
}

/** "1h 12m" — lectura humana de una duración, sin segundos. */
export function duracionCorta(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** SLA de un ticket según su clasificación, o el del tipo si no tiene. */
export function slaDe(
  cat: CatalogosSoporte,
  tipoCodigo: string,
  clasificacionCodigo: string | null | undefined
): number | null {
  if (clasificacionCodigo) {
    const c = cat.clasificaciones.find((x) => x.codigo === clasificacionCodigo);
    if (c) return Number(c.sla_horas);
  }
  const t = cat.tipos.find((x) => x.codigo === tipoCodigo);
  return t?.sla_horas == null ? null : Number(t.sla_horas);
}

// ------------------------------------------------------------------ tickets

export type TicketFila = {
  id: string;
  numero: number;
  asunto: string;
  descripcion: string;
  resultado_esperado: string | null;
  impacto_operativo: string | null;
  pasos_reproducir: string | null;
  criterios_aceptacion: string | null;
  cliente_id: string | null;
  proyecto_id: string | null;
  modulo: string | null;
  version: string | null;
  entorno: string | null;
  navegador: string | null;
  tipo_codigo: string;
  clasificacion_codigo: string | null;
  prioridad_codigo: string;
  estado_codigo: string;
  responsable_id: string | null;
  proxima_accion: string | null;
  sla_horas: number | string | null;
  fecha_objetivo: string | null;
  resuelto_at: string | null;
  cerrado_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  /** `manual` (alta en Soporte) o `tipificacion_cliente`. Null en tickets anteriores. */
  origen: string | null;
  tipificacion_id: string | null;
  /** Ciclos de corrección: 1 al crearse, +1 cada vez que QA pide cambios. */
  fase: number;
};

export const TICKET_CAMPOS =
  "id, numero, asunto, descripcion, resultado_esperado, impacto_operativo, pasos_reproducir, criterios_aceptacion, cliente_id, proyecto_id, modulo, version, entorno, navegador, tipo_codigo, clasificacion_codigo, prioridad_codigo, estado_codigo, responsable_id, proxima_accion, sla_horas, fecha_objetivo, resuelto_at, cerrado_at, created_by, updated_by, created_at, updated_at, origen, tipificacion_id, fase";

/**
 * Etiqueta del "tipo de solicitud" para gráficos y listados.
 *
 * Los cambios se abren en estético y funcional —son servicios con SLA muy
 * distinto (5 h contra 48 h)—; los demás tipos se muestran tal cual.
 */
export function etiquetaTipo(
  cat: CatalogosSoporte,
  tipoCodigo: string,
  clasificacionCodigo: string | null
): string {
  if (tipoCodigo === "cambio" && clasificacionCodigo) {
    const c = cat.clasificaciones.find((x) => x.codigo === clasificacionCodigo);
    if (c) return c.nombre;
  }
  return cat.tipos.find((x) => x.codigo === tipoCodigo)?.nombre ?? tipoCodigo;
}

/** Pestañas del listado. */
export const PESTANAS_TICKETS = [
  { id: "todos", etiqueta: "Todos", estados: null as string[] | null },
  { id: "pendientes", etiqueta: "Pendientes", estados: ["pendiente"] },
  { id: "en_proceso", etiqueta: "En proceso", estados: ["en_proceso", "reabierto"] },
  { id: "falta_informacion", etiqueta: "Falta información", estados: ["falta_informacion"] },
  { id: "revision", etiqueta: "En revisión", estados: ["listo_revision"] },
  { id: "resueltos", etiqueta: "Resueltos", estados: ["resuelto"] },
  { id: "cerrados", etiqueta: "Cerrados", estados: ["cerrado", "cancelado"] },
] as const;

export type PestanaTickets = (typeof PESTANAS_TICKETS)[number]["id"];

/** Tipos de relación entre tickets. El MVP usa "relacionado"; el resto queda preparado. */
export const TIPOS_RELACION = [
  { codigo: "relacionado", nombre: "Relacionado con" },
  { codigo: "duplicado_de", nombre: "Duplicado de" },
  { codigo: "bloquea", nombre: "Bloquea" },
  { codigo: "bloqueado_por", nombre: "Bloqueado por" },
  { codigo: "deriva_de", nombre: "Deriva de" },
] as const;

/**
 * Evidencias: se acepta cualquier archivo (Excel, Word, ZIP, capturas, videos,
 * logs…) salvo lo que se ejecuta o se abre como página. Esos quedan afuera
 * porque el bucket se sirve por URL: un .html o .svg correría en el navegador
 * de quien lo abre, y un .exe o .bat es la forma clásica de colar un virus.
 */
const EXTENSIONES_BLOQUEADAS =
  /\.(exe|msi|msp|bat|cmd|com|scr|pif|cpl|dll|sys|vbs|vbe|js|mjs|jse|wsf|wsh|hta|ps1|psm1|sh|jar|app|apk|lnk|reg|html?|xhtml|svg|svgz|php|asp|aspx|jsp)$/i;
const MIMES_BLOQUEADOS = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "application/javascript",
  "text/javascript",
  "application/x-msdownload",
  "application/x-msdos-program",
  "application/x-sh",
  "application/java-archive",
  "application/vnd.android.package-archive",
]);

/**
 * 50 MB por archivo: es el tope que tiene el bucket en Storage. Poner más acá
 * sólo hacía que la subida fallara al final con un error confuso.
 */
export const ARCHIVO_MAX_BYTES = 50 * 1024 * 1024;

export function mimeAceptado(mime: string, nombre: string): boolean {
  if (EXTENSIONES_BLOQUEADAS.test(nombre.trim())) return false;
  return !MIMES_BLOQUEADOS.has((mime || "").toLowerCase());
}

export function tamanoLegible(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
