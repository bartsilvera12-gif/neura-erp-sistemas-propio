/** Una pieza del catálogo: un servicio que se puede sumar a una propuesta. */
export type Pieza = {
  id: string;
  seccion: string;
  titulo: string;
  descripcion: string;
  sort_order: number;
};

/** Una pieza ya puesta en una propuesta: copia del texto, así editar el catálogo no cambia propuestas viejas. */
export type PiezaEnPropuesta = { pieza_id: string | null; titulo: string; descripcion: string };

export type Propuesta = {
  id: string;
  numero: number;
  cliente_id: string | null;
  cliente_nombre: string;
  titulo: string;
  bajada: string;
  piezas: PiezaEnPropuesta[];
  inversion_total: number | null;
  cuota_mensual: number | null;
  condiciones: string;
  /** Clientes bandera que se muestran en el pie de la propuesta. */
  clientes_bandera: string[];
  created_at: string;
  updated_at: string;
};

export const CONDICIONES_POR_DEFECTO =
  "Alcance técnico, plazos y condiciones de pago: sujetos a acuerdo entre las partes.\nCostos y consumos de plataformas externas no incluidos, salvo acuerdo expreso.";
