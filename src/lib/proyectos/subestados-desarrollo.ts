/**
 * Sub-etapas de desarrollo — detalle del avance dentro del estado "En desarrollo".
 *
 * Es un eje acotado sobre `proyectos.subestado_desarrollo` que sólo tiene sentido
 * mientras el proyecto está en el estado con código `desarrollo`. No reemplaza al
 * Kanban comercial (`proyecto_estados`, configurable por empresa) ni a los ejes de
 * `etapa_desarrollo` / `qa_etapa`: es un nivel más fino que responde "¿en qué parte
 * del desarrollo estamos?".
 *
 * El catálogo es fijo en código (no configurable por empresa) y depende del tipo de
 * proyecto: las páginas web y los SaaS/ERP tienen fases distintas. Un proyecto mixto
 * (`web_saas`) ve las dos listas. Los códigos van prefijados (`web_` / `saas_`) para
 * que nunca colisionen y una misma columna pueda guardar cualquiera de los dos.
 *
 * Módulo isomórfico: lo importan tanto las rutas de API (validación + historial)
 * como el cliente (selector en la tarjeta del proyecto).
 */

import { tipoIncluyeSaas, tipoIncluyeWeb } from "@/lib/proyectos/tipos-proyecto";

export type FamiliaSubestado = "web" | "saas";

export type SubestadoDesarrollo = {
  codigo: string;
  nombre: string;
  familia: FamiliaSubestado;
};

/** Fases de desarrollo de una página web. */
export const SUBESTADOS_DESARROLLO_WEB: readonly SubestadoDesarrollo[] = [
  { codigo: "web_maquetado", nombre: "Maquetado", familia: "web" },
  { codigo: "web_diseno_visual", nombre: "Diseño visual", familia: "web" },
  { codigo: "web_carga_contenido", nombre: "Carga de contenido", familia: "web" },
  { codigo: "web_funcionalidades", nombre: "Funcionalidades / formularios", familia: "web" },
  { codigo: "web_responsive", nombre: "Responsive", familia: "web" },
  { codigo: "web_optimizacion", nombre: "Optimización (SEO/velocidad)", familia: "web" },
  { codigo: "web_revision_final", nombre: "Revisión final", familia: "web" },
] as const;

/** Fases de desarrollo de un SaaS/ERP. */
export const SUBESTADOS_DESARROLLO_SAAS: readonly SubestadoDesarrollo[] = [
  { codigo: "saas_relevamiento", nombre: "Relevamiento / análisis", familia: "saas" },
  { codigo: "saas_modelado_datos", nombre: "Modelado de datos", familia: "saas" },
  { codigo: "saas_backend", nombre: "Backend / lógica", familia: "saas" },
  { codigo: "saas_config_modulos", nombre: "Configuración de módulos", familia: "saas" },
  { codigo: "saas_integraciones", nombre: "Integraciones", familia: "saas" },
  { codigo: "saas_pruebas_internas", nombre: "Pruebas internas", familia: "saas" },
] as const;

export const SUBESTADOS_DESARROLLO_ALL: readonly SubestadoDesarrollo[] = [
  ...SUBESTADOS_DESARROLLO_WEB,
  ...SUBESTADOS_DESARROLLO_SAAS,
];

const POR_CODIGO = new Map(SUBESTADOS_DESARROLLO_ALL.map((s) => [s.codigo, s] as const));

/** Sub-etapas aplicables a un tipo de proyecto (web, saas o ambas si es mixto). */
export function subestadosParaTipo(tipoCodigo: string | null | undefined): SubestadoDesarrollo[] {
  const t = String(tipoCodigo ?? "");
  const out: SubestadoDesarrollo[] = [];
  if (tipoIncluyeWeb(t)) out.push(...SUBESTADOS_DESARROLLO_WEB);
  if (tipoIncluyeSaas(t)) out.push(...SUBESTADOS_DESARROLLO_SAAS);
  return out;
}

/** ¿`value` es el código de alguna sub-etapa conocida? */
export function esSubestadoDesarrollo(value: unknown): value is string {
  return typeof value === "string" && POR_CODIGO.has(value);
}

/** ¿La sub-etapa `codigo` corresponde al tipo de proyecto `tipoCodigo`? */
export function esSubestadoValidoParaTipo(
  codigo: string,
  tipoCodigo: string | null | undefined
): boolean {
  return subestadosParaTipo(tipoCodigo).some((s) => s.codigo === codigo);
}

/** Nombre visible de una sub-etapa; `null` si no hay o no se reconoce el código. */
export function subestadoDesarrolloLabel(codigo: string | null | undefined): string | null {
  if (!codigo) return null;
  return POR_CODIGO.get(codigo)?.nombre ?? codigo;
}
