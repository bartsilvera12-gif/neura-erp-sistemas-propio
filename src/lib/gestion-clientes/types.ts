export type TipoGestion =
  | "Consulta"
  | "Reclamo"
  | "Seguimiento"
  | "Promesa de pago"
  | "Soporte técnico"
  | "Cambio plan"
  /** Escala a un ticket de Soporte (ver /api/clientes/[id]/tipificaciones). */
  | "Error";

export type ResultadoTipificacion = "Pendiente" | "Resuelto" | "Escalar";

export const TIPOS_GESTION: readonly TipoGestion[] = [
  "Consulta",
  "Reclamo",
  "Seguimiento",
  "Promesa de pago",
  "Soporte técnico",
  "Cambio plan",
  "Error",
];

export const RESULTADOS_TIPIFICACION: readonly ResultadoTipificacion[] = ["Pendiente", "Resuelto", "Escalar"];

/** Ticket de Soporte vinculado a una tipificación. Sólo lo operativo: nada de credenciales. */
export interface TicketDeTipificacion {
  id: string;
  numero: number;
  asunto: string;
  estado_codigo: string;
  estado_nombre: string;
  estado_color: string | null;
  prioridad_codigo: string;
  prioridad_nombre: string;
  proyecto_id: string | null;
  proyecto_titulo: string | null;
}

export interface Tipificacion {
  id:           string;
  cliente_id:   string;
  fecha:        string;               // ISO string
  usuario:      string;
  tipo_gestion: TipoGestion;
  resultado:    ResultadoTipificacion;
  observacion:  string;
  /** Usuario del catálogo que la registró (null en tipificaciones anteriores). */
  usuario_id?:  string | null;
  /** Ticket generado desde esta tipificación, si lo hay. */
  ticket?:      TicketDeTipificacion | null;
}

/** `Corregida NC`: saldo liquidado por nota de crédito aprobada por SET (no es cobro registrado en `pagos`). */
export type EstadoFactura = "Pagado" | "Pendiente" | "Vencido" | "Anulado" | "Corregida NC";

export interface Factura {
  id:                string;
  cliente_id:        string;
  numero_factura:    string;
  fecha:             string;          // YYYY-MM-DD
  fecha_vencimiento: string;          // YYYY-MM-DD
  monto:             number;
  saldo:             number;
  estado:            EstadoFactura;
  tipo:              "contado" | "credito" | "suscripcion";
  moneda:            "GS" | "USD";
  /** Última fecha de pago registrada en `pagos` (GET /api/facturas enriquecido). */
  fecha_pago_registro?: string | null;
}
