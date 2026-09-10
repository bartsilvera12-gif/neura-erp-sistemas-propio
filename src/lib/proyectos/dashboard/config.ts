/**
 * Parámetros de los dashboards de Proyectos (Ejecutivo y PM).
 *
 * Todo lo que acá es una constante es un DEFAULT, no una regla enterrada: el
 * objetivo de SLV técnico sale del catálogo `proyecto_slv_objetivos` de cada
 * empresa y del `config` del tipo de proyecto, y estos valores sólo se usan
 * cuando la empresa todavía no configuró nada.
 *
 * La resolución de estados es SIEMPRE por `codigo` y `tipo_sla`, nunca por el
 * nombre visible: cada empresa renombra sus columnas (hoy `brief_cargado` se
 * muestra como "Publicado / Pendiente de Capacitación" y `enviado_cliente` como
 * "Revisión Cliente"). El nombre se usa para mostrar y nada más.
 */

/**
 * Estados en los que el trabajo está EFECTIVAMENTE bajo responsabilidad del
 * desarrollador. Sólo acá corre el reloj de SLV técnico.
 *
 * QA no entra: el proyecto está en manos de QA, no del técnico. `cambios_solicitados`
 * sí, porque es el técnico corrigiendo lo observado.
 */
export const CODIGOS_RESPONSABILIDAD_TECNICA = ["desarrollo", "cambios_solicitados"] as const;

/** La columna de desarrollo propiamente dicha, sin los cambios solicitados. */
export const CODIGO_DESARROLLO = "desarrollo";

/**
 * Estados de revisión de QA. Cada ENTRADA a uno de ellos es una ronda.
 *
 * Sólo la columna QA. "Revisión interna" viene en la semilla original pero la
 * empresa no la usa como paso de QA, y contarla infliaría las rondas de todos
 * los proyectos viejos. Si algún día se usa, se agrega acá.
 */
export const CODIGOS_QA = ["qa"] as const;

/**
 * Estados "listo para entregar": el trabajo terminó pero la entrega no se
 * cerró. Hoy son "Listo para publicar" y la columna que la empresa usa como
 * "Publicado / Pendiente de Capacitación" (código histórico `brief_cargado`).
 */
export const CODIGOS_LISTO_ENTREGAR = ["listo_publicar", "brief_cargado"] as const;

/** Estado final que representa una ENTREGA (los otros finales son cancelaciones). */
export const CODIGO_ENTREGADO = "publicado";

/** Ventana de "vence pronto", en días hasta la fecha prometida. */
export const DIAS_VENCE_PRONTO = 3;

/**
 * Límite de proyectos activos por técnico. Por encima, la carga se considera
 * insostenible y el técnico entra en "WIP alto".
 */
export const WIP_LIMITE_DEFAULT = 4;

/**
 * "Sin movimiento": una jornada laboral completa sin actividad técnica real.
 * Se mide con el reloj laboral, no con horas corridas: un proyecto tocado el
 * viernes a las 16 h no está abandonado el lunes a las 9 h.
 */
export const MS_SIN_MOVIMIENTO = 9 * 60 * 60 * 1000;

/**
 * Catálogo por defecto de objetivos de SLV técnico, en horas laborales.
 *
 * Son los valores de referencia que bajó Dirección. Viven acá sólo como semilla
 * y fallback: la migración `20260907120000_proyectos_dashboard_slv.sql` los
 * inserta en `proyecto_slv_objetivos` por empresa, y desde ahí se administran.
 */
export const SLV_OBJETIVOS_DEFAULT: { codigo: string; nombre: string; horas: number; orden: number }[] = [
  { codigo: "correccion_menor", nombre: "Corrección menor", horas: 4, orden: 10 },
  { codigo: "cambio_menor", nombre: "Cambio menor", horas: 8, orden: 20 },
  { codigo: "cambio_medio", nombre: "Cambio medio", horas: 16, orden: 30 },
  { codigo: "web_estandar", nombre: "Web estándar", horas: 24, orden: 40 },
  { codigo: "erp_estandar", nombre: "ERP estándar", horas: 40, orden: 50 },
  { codigo: "desarrollo_mayor", nombre: "Desarrollo mayor", horas: 80, orden: 60 },
];

/**
 * Objetivo por defecto según el tipo de proyecto, cuando el proyecto no eligió
 * uno y el tipo tampoco lo configuró. Se resuelve por el `codigo` del tipo.
 */
export const SLV_OBJETIVO_POR_TIPO: Record<string, string> = {
  web: "web_estandar",
  saas: "erp_estandar",
  erp: "erp_estandar",
  saas_erp: "erp_estandar",
};

/** Tipos de bloqueo que se cargan a mano en `proyectos.bloqueo_tipo`. */
export const BLOQUEO_TIPOS = ["cliente", "interno", "tercero"] as const;
export type BloqueoTipo = (typeof BLOQUEO_TIPOS)[number];

/**
 * Quién tiene que destrabar el proyecto.
 *
 * Va como ROL y no como persona a propósito: la mitad de los bloqueos los traba
 * el cliente o un proveedor, que no son usuarios del sistema. Y al ser una
 * lista cerrada se puede contar —"cuántos proyectos están frenados por el
 * cliente"—, que es lo que convierte un bloqueo en algo gestionable.
 */
export const BLOQUEO_RESPONSABLES = [
  "cliente",
  "pm",
  "programador",
  "qa",
  "comercial",
  "tercero",
] as const;
export type BloqueoResponsable = (typeof BLOQUEO_RESPONSABLES)[number];

export const BLOQUEO_RESPONSABLE_LABEL: Record<BloqueoResponsable, string> = {
  cliente: "Cliente",
  pm: "PM",
  programador: "Programador",
  qa: "QA",
  comercial: "Comercial",
  tercero: "Proveedor / Tercero",
};

/**
 * La categoría gruesa que ya leen el dashboard y los reportes, deducida del
 * responsable. Se deriva en vez de pedirse: son el mismo dato con distinto
 * grano, y preguntarlo dos veces es la forma más segura de que queden en
 * desacuerdo.
 */
export function tipoDesdeResponsable(r: BloqueoResponsable): BloqueoTipo {
  if (r === "cliente") return "cliente";
  if (r === "tercero") return "tercero";
  return "interno";
}

export function esBloqueoResponsable(v: unknown): v is BloqueoResponsable {
  return typeof v === "string" && (BLOQUEO_RESPONSABLES as readonly string[]).includes(v);
}

/**
 * Categorías que se MUESTRAN.
 *
 * Suma "pausa" a las tres que se cargan a mano. Un proyecto parado en la
 * columna Pausado está detenido, pero no es un bloqueo interno: meterlo en
 * "Interno" escondía cuatro proyectos pausados detrás de una etiqueta que no
 * los describe. La columna de la base sigue teniendo sus tres valores; esto es
 * sólo cómo se agrupa para leer.
 */
export const BLOQUEO_CATEGORIAS = ["cliente", "tercero", "interno", "pausa"] as const;
export type BloqueoCategoria = (typeof BLOQUEO_CATEGORIAS)[number];

export const BLOQUEO_TIPO_LABEL: Record<BloqueoCategoria, string> = {
  cliente: "Cliente",
  interno: "Interno",
  tercero: "Tercero",
  pausa: "Pausado",
};

/**
 * Categoría de un proyecto detenido. Lo cargado a mano manda; si no hay nada,
 * lo dice su estado, que es un dato real y no una suposición.
 */
export function categoriaBloqueo(p: {
  bloqueo_tipo: BloqueoTipo | null;
  espera_cliente: boolean;
  pausado: boolean;
}): BloqueoCategoria {
  if (p.bloqueo_tipo) return p.bloqueo_tipo;
  if (p.pausado) return "pausa";
  if (p.espera_cliente) return "cliente";
  return "interno";
}
