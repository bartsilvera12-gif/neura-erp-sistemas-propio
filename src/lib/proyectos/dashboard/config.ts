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

/** Tipos de bloqueo. `bloqueo_tipo` en `proyectos`; el motivo sigue siendo texto libre. */
export const BLOQUEO_TIPOS = ["cliente", "interno", "tercero"] as const;
export type BloqueoTipo = (typeof BLOQUEO_TIPOS)[number];

export const BLOQUEO_TIPO_LABEL: Record<BloqueoTipo, string> = {
  cliente: "Cliente",
  interno: "Interno",
  tercero: "Tercero",
};
