/**
 * Qué estados del Kanban comercial forman el tablero "Tareas del equipo".
 *
 * El tablero del técnico y el Kanban comercial comparten un único eje: el
 * `estado_id` del proyecto (`proyecto_estados`, configurable por empresa). Antes
 * el tablero corría sobre un eje propio (`etapa_desarrollo`), y los dos podían
 * decir cosas distintas del mismo proyecto — un proyecto "Publicado" para
 * comercial seguía figurando "En Desarrollo" en la tarjeta del programador.
 *
 * Un proyecto aparece en la tarjeta de su técnico sólo si está en uno de estos
 * estados. Fuera de ellos (Nuevo, En cola, Entregado) el técnico no tiene nada
 * que hacer y el proyecto no le ocupa lugar.
 */

/**
 * Códigos de `proyecto_estados`, en el orden en que se muestran las
 * subsecciones de cada tarjeta. El orden es el del flujo de trabajo, no el
 * `sort_order` del Kanban: primero lo que está en curso, al final lo detenido.
 *
 * OJO con `brief_cargado`: es el código que hoy lleva el nombre visible
 * "Publicado / Pendiente de Capacitación". La empresa renombró esa columna
 * reusando la fila original del seed, así que el código quedó con el nombre
 * viejo. Siempre mostrar `nombre`, nunca el código.
 */
export const CODIGOS_TABLERO_TECNICO = [
  "desarrollo",
  "cambios_solicitados",
  "qa",
  // Revisión con el cliente: nada que el técnico tenga que hacer, pero sigue
  // siendo SU proyecto hasta que se aprueba o se devuelve — se queda visible
  // para que no lo pierda de vista mientras espera. El nombre de la columna
  // lo define cada empresa (hoy "Revisión Cliente"); el código no cambia.
  "enviado_cliente",
  "brief_cargado",
  "pausado",
] as const;

export type CodigoTableroTecnico = (typeof CODIGOS_TABLERO_TECNICO)[number];

const ORDEN = new Map<string, number>(CODIGOS_TABLERO_TECNICO.map((c, i) => [c, i]));

export function esEstadoDeTablero(codigo: string | null | undefined): boolean {
  return typeof codigo === "string" && ORDEN.has(codigo);
}

/** Posición de la subsección. Los desconocidos van al final, nunca se pierden. */
export function ordenTablero(codigo: string | null | undefined): number {
  if (typeof codigo !== "string") return CODIGOS_TABLERO_TECNICO.length;
  return ORDEN.get(codigo) ?? CODIGOS_TABLERO_TECNICO.length;
}

/**
 * Proyección del estado del Kanban sobre el eje técnico `etapa_desarrollo`.
 *
 * `etapa_desarrollo` dejó de editarse a mano: el tablero del técnico ahora
 * mueve `estado_id`, que es la única fuente de verdad. Pero dos reportes siguen
 * leyendo la etapa —el de finalizados del mes por programador y el gerencial de
 * producción (`wip_por_etapa`, entregados del mes)—, así que se la mantiene
 * derivada en cada cambio de estado. Sin esto, esos dos reportes se congelarían
 * en silencio el día que nadie vuelva a tocar la etapa.
 *
 * `null` = el estado no dice nada sobre el avance técnico y la etapa se deja
 * como está: pausar un proyecto no lo hace retroceder, y las columnas
 * puramente comerciales (Nuevo, En cola) no son trabajo del técnico.
 */
const ETAPA_POR_ESTADO: Record<string, string | null> = {
  desarrollo: "en_desarrollo",
  // Sigue siendo trabajo del programador: está corrigiendo lo observado.
  cambios_solicitados: "en_desarrollo",
  qa: "qa",
  // En revisión con el cliente el técnico ya entregó su parte; si piden
  // cambios vuelve a "en_desarrollo" recién cuando el estado cambie de verdad.
  enviado_cliente: null,
  // "Publicado / Pendiente de Capacitación": para el técnico ya está entregado.
  brief_cargado: "finalizado",
  publicado: "finalizado",
  pausado: null,
};

export function etapaDesdeEstado(codigo: string | null | undefined): string | null {
  if (typeof codigo !== "string") return null;
  return ETAPA_POR_ESTADO[codigo] ?? null;
}

/** Forma mínima de una fila de `proyecto_estados` para resolver el tablero. */
export type EstadoTablero = {
  id: string;
  codigo: string | null;
  nombre: string | null;
  color: string | null;
  tipo_sla: string | null;
};

/**
 * El estado que congela el contador.
 *
 * Se resuelve por `tipo_sla = 'pausado'` y no por el código, porque es la
 * semántica que ya usa el resto del módulo (el SLA del Kanban también deja de
 * correr ahí). Una empresa puede llamar a su columna como quiera.
 */
export function esEstadoPausado(estado: Pick<EstadoTablero, "tipo_sla"> | null | undefined): boolean {
  return (estado?.tipo_sla ?? "") === "pausado";
}

/**
 * Estados del tablero presentes en la empresa, ya ordenados para las
 * subsecciones. Se filtra contra los estados reales: si una empresa no tiene
 * alguna de estas columnas, simplemente no aparece esa subsección.
 */
export function estadosDeTablero<T extends EstadoTablero>(estados: T[]): T[] {
  return estados
    .filter((e) => esEstadoDeTablero(e.codigo))
    .sort((a, b) => ordenTablero(a.codigo) - ordenTablero(b.codigo));
}
