import "server-only";

/**
 * Umbrales y definiciones canónicas del reporte de Producción.
 *
 * Centraliza en un solo lugar dos reglas que hoy están dispersas / hardcodeadas en el repo
 * con valores y semánticas distintas:
 *   - `/api/proyectos/dashboard`  → "por vencer" a 2 días (sobre fecha_prometida)
 *   - `src/lib/proyectos/sla-badge.ts` (código muerto) → "por_vencer" a 2 días
 *   - `ProyectosKanbanClient.tsx`  → ventana post-entrega de 30 días
 *   - `TareasEquipoClient.tsx`     → badge rojo a 30 días desde asignación
 * Ninguno es el umbral de "estancado" que necesita este reporte; acá lo definimos una sola vez.
 */

/**
 * Códigos de estado que representan CANCELACIÓN (no entrega).
 *
 * Trampa del modelo: un estado cancelado comparte flags con uno de entrega
 * (`tipo_sla='final'`, `es_estado_final=true`, `cuenta_sla=false`); la única señal que los
 * distingue es el `codigo`. Por eso la exclusión de cancelados es explícita y configurable acá,
 * y NO enterrada en un WHERE. Los cancelados van a un contador propio (tasa de cancelación),
 * nunca sumados a "entregados".
 */
export const CODIGOS_CANCELACION: readonly string[] = ["cancelado"];

export function esCancelacion(codigo: string | null | undefined): boolean {
  return codigo != null && CODIGOS_CANCELACION.includes(codigo);
}

/**
 * Un estado es de ENTREGA si es final, activo y NO es de cancelación.
 * Unifica la contradicción del repo: `/api/proyectos/dashboard` usa `es_estado_final` (incluye
 * cancelado = bug); `entregados-por-tecnico` hardcodea `codigo='publicado'` (rompe si el tenant
 * personalizó sus estados finales). Esta definición cubre ambos casos correctamente.
 */
export function esEstadoEntrega(estado: {
  codigo: string | null;
  es_estado_final: boolean | null;
  activo: boolean | null;
}): boolean {
  return estado.es_estado_final === true && estado.activo !== false && !esCancelacion(estado.codigo);
}

/**
 * Umbral de "estancado" por `tipo_sla` cuando el estado no define `sla_horas_objetivo`.
 *   - `interno`  → 7 días  (responsabilidad del área)
 *   - `cliente`  → 21 días (espera externa: se reporta con tono neutro, no cuenta como falla del área)
 *   - `pausado`  → no aplica (excluido)
 *   - `final`    → no aplica (excluido)
 */
export const UMBRAL_DEFAULT_DIAS: Record<string, number | null> = {
  interno: 7,
  cliente: 21,
  pausado: null,
  final: null,
};

export type EstadoUmbralInput = {
  tipo_sla: string | null;
  sla_horas_objetivo: number | null;
};

/**
 * Umbral de estancamiento en segundos para un estado, o `null` si el estado no aplica
 * (`pausado`/`final`). Preferencia: `sla_horas_objetivo` explícito del estado → default por tipo.
 */
export function umbralEstancadoSegundos(estado: EstadoUmbralInput): number | null {
  if (
    typeof estado.sla_horas_objetivo === "number" &&
    Number.isFinite(estado.sla_horas_objetivo) &&
    estado.sla_horas_objetivo > 0
  ) {
    return estado.sla_horas_objetivo * 3600;
  }
  const tipo = (estado.tipo_sla ?? "interno").trim();
  const dias = UMBRAL_DEFAULT_DIAS[tipo];
  return dias == null ? null : dias * 86400;
}

/** `true` si el estancamiento del estado es responsabilidad del área técnica (tipo interno). */
export function esResponsabilidadArea(tipo_sla: string | null): boolean {
  return (tipo_sla ?? "interno").trim() === "interno";
}
