/**
 * NEURA QA CENTER — reglas de ciclo de vida del proyecto.
 *
 * Ciclo soportado:
 *   en_desarrollo → (autorización 72h firmada) → en_qa → (vencimiento o re-autorización)
 *                                                      → entregado (bloqueo total)
 *
 * Principios:
 *   - Las declaraciones humanas NO reemplazan la validación técnica (env-assert).
 *   - Proyecto `entregado`: bloqueo total (lectura y escritura).
 *   - Autorización vencida: tratar como `en_desarrollo` — no se puede ejecutar.
 *   - La URL del target no determina el estado — sólo este campo lo hace.
 */

export type EstadoEntrega = "en_desarrollo" | "en_qa" | "entregado";

export type DeclaracionesAutorizacion = {
  no_entregado: boolean;
  datos_ficticios: boolean;
  integraciones_aisladas: boolean;
};

export type EstadoProyectoRow = {
  estado_entrega: EstadoEntrega;
  autorizacion_qa_hasta: string | null;
};

export type Veredicto =
  | { ok: true }
  | { ok: false; codigo: "entregado" | "no_autorizado" | "autorizacion_vencida" | "estado_desconocido"; razon: string };

/** Duración por defecto de la autorización, en horas. */
export const AUTORIZACION_HORAS = 72;

/**
 * Decide si un proyecto puede encolar/ejecutar runs.
 * Fail-closed: cualquier estado no reconocido rechaza.
 */
export function puedeEjecutarRun(p: EstadoProyectoRow, ahora: Date = new Date()): Veredicto {
  if (p.estado_entrega === "entregado") {
    return {
      ok: false,
      codigo: "entregado",
      razon: "El proyecto fue marcado como entregado al cliente — QA Desarrollo está bloqueado.",
    };
  }
  if (p.estado_entrega === "en_desarrollo") {
    return {
      ok: false,
      codigo: "no_autorizado",
      razon:
        "El proyecto está en desarrollo y no tiene autorización vigente. Autorizalo con las 3 declaraciones antes de ejecutar pruebas.",
    };
  }
  if (p.estado_entrega === "en_qa") {
    if (!p.autorizacion_qa_hasta) {
      return {
        ok: false,
        codigo: "no_autorizado",
        razon: "El proyecto está marcado en_qa pero sin fecha de vencimiento de autorización.",
      };
    }
    const hasta = new Date(p.autorizacion_qa_hasta);
    if (hasta.getTime() <= ahora.getTime()) {
      return {
        ok: false,
        codigo: "autorizacion_vencida",
        razon: `La autorización de QA venció el ${hasta.toISOString()}. Renovala para continuar.`,
      };
    }
    return { ok: true };
  }
  return { ok: false, codigo: "estado_desconocido", razon: `estado_entrega inválido: ${String(p.estado_entrega)}` };
}

/**
 * Valida que las 3 declaraciones humanas estén presentes y en `true`.
 * Devuelve error específico por cuál falta.
 */
export function validarDeclaraciones(d: Partial<DeclaracionesAutorizacion>): { ok: true; declaraciones: DeclaracionesAutorizacion } | { ok: false; razon: string } {
  if (d.no_entregado !== true) return { ok: false, razon: "Falta declarar: el ERP no fue entregado al cliente." };
  if (d.datos_ficticios !== true) return { ok: false, razon: "Falta declarar: la base no contiene datos reales del cliente." };
  if (d.integraciones_aisladas !== true)
    return { ok: false, razon: "Falta declarar: integraciones externas aisladas o deshabilitadas." };
  return {
    ok: true,
    declaraciones: {
      no_entregado: true,
      datos_ficticios: true,
      integraciones_aisladas: true,
    },
  };
}

/** Calcula el vencimiento sumando AUTORIZACION_HORAS a `desde`. */
export function calcularVencimiento(desde: Date = new Date()): Date {
  return new Date(desde.getTime() + AUTORIZACION_HORAS * 3600 * 1000);
}
