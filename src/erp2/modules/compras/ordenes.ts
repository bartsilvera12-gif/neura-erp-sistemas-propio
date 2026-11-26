/** Órdenes de compra: tipos y validación compartidos. */
import { z } from "zod";

export type EstadoOC = "pendiente" | "recibida_parcial" | "recibida_total" | "cancelada";

export type OrdenItem = {
  id: string;
  producto_id: string;
  producto_nombre: string;
  producto_sku: string | null;
  cantidad: number;
  cantidad_recibida: number;
  costo_unitario_original: number;
  costo_unitario: number;
  tipo_iva: string;
  total: number;
};

export type OrdenCompra = {
  id: string;
  numero_oc: string;
  proveedor_id: string;
  proveedor_nombre: string;
  fecha: string;
  fecha_entrega: string | null;
  tipo_pago: "contado" | "credito";
  plazo_dias: number | null;
  moneda: "GS" | "USD";
  tipo_cambio: number;
  total: number;
  estado: EstadoOC;
  observacion: string | null;
  usuario_nombre: string | null;
  cancelada_at: string | null;
  cancelada_por: string | null;
  cancelada_motivo: string | null;
  items?: OrdenItem[];
  /** resumen para la lista */
  cantidad_items?: number;
  unidades?: number;
  recibidas?: number;
  /** compras con las que se recibió */
  compras?: { id: string; numero_control: string; numero_factura: string; fecha: string; total: number; estado: string }[];
};

export const COLS_OC =
  "id, numero_oc, proveedor_id, proveedor_nombre, fecha, fecha_entrega, tipo_pago, plazo_dias, moneda, tipo_cambio, total, estado, observacion, usuario_nombre, cancelada_at, cancelada_por, cancelada_motivo";
export const COLS_OC_ITEM =
  "id, producto_id, producto_nombre, producto_sku, cantidad, cantidad_recibida, costo_unitario_original, costo_unitario, tipo_iva, total";

export const ESTADO_OC: Record<EstadoOC, { texto: string; clase: string }> = {
  pendiente: { texto: "Pendiente", clase: "bg-sky-50 text-sky-700" },
  recibida_parcial: { texto: "Recibida en parte", clase: "bg-amber-50 text-amber-700" },
  recibida_total: { texto: "Recibida", clase: "bg-emerald-50 text-emerald-700" },
  cancelada: { texto: "Cancelada", clase: "bg-slate-100 text-slate-500" },
};

export const cuerpoOrden = z.object({
  proveedor_id: z.string().uuid("Elegí el proveedor"),
  fecha_entrega: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("")),
  tipo_pago: z.enum(["contado", "credito"]).default("contado"),
  plazo_dias: z.coerce.number().int().min(0).max(3650).nullish(),
  moneda: z.enum(["GS", "USD"]).default("GS"),
  tipo_cambio: z.coerce.number().positive().nullish(),
  observacion: z.string().trim().max(2000).nullish(),
  /** al crear: un doble clic / reintento devuelve la orden ya creada */
  idempotency_key: z.string().uuid().nullish(),
  items: z
    .array(
      z.object({
        producto_id: z.string().uuid(),
        cantidad: z.coerce.number().positive("La cantidad tiene que ser mayor a 0"),
        costo_unitario: z.coerce.number().min(0).default(0),
      }),
    )
    .min(1, "La orden no tiene productos")
    .max(300),
});
