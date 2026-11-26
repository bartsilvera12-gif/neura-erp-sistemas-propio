/** Proveedores: tipos compartidos (cliente y servidor). */
export type CategoriaProveedor = { id: string; nombre: string; activo: boolean };

export type Proveedor = {
  id: string;
  nombre: string; // razón social
  nombre_comercial: string | null;
  ruc: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  ciudad: string | null;
  contacto: string | null;
  contacto_telefono: string | null;
  condicion_pago: "contado" | "credito";
  plazo_pago_dias: number | null;
  moneda: "GS" | "USD";
  observaciones: string | null;
  activo: boolean;
  created_at?: string;
  categorias: CategoriaProveedor[];
  /** compras registradas (kardex) y la última */
  compras: number;
  ultima_compra: string | null;
};

export const COLS_PROVEEDOR =
  "id, nombre, nombre_comercial, ruc, telefono, email, direccion, ciudad, contacto, contacto_telefono, condicion_pago, plazo_pago_dias, moneda, observaciones, activo, created_at";

/**
 * Versión liviana (GET /api/proveedores?min=1): lo que necesitan el selector, los
 * filtros por proveedor y las condiciones que se proponen al cargar una compra/orden.
 * Sin rubros ni compras (evita el agregado compras_por_proveedor).
 */
export type ProveedorMin = Pick<
  Proveedor,
  "id" | "nombre" | "nombre_comercial" | "ruc" | "contacto" | "activo" | "condicion_pago" | "plazo_pago_dias" | "moneda"
>;

export const COLS_PROVEEDOR_MIN = "id, nombre, nombre_comercial, ruc, contacto, activo, condicion_pago, plazo_pago_dias, moneda";

/** Nombre para mostrar: el comercial si lo tiene, si no la razón social. */
export const nombreProveedor = (p: Pick<Proveedor, "nombre" | "nombre_comercial">) => p.nombre_comercial?.trim() || p.nombre;

/** "Contado" / "Crédito 30 días". */
export function condicionTexto(p: Pick<Proveedor, "condicion_pago" | "plazo_pago_dias">) {
  if (p.condicion_pago !== "credito") return "Contado";
  return p.plazo_pago_dias ? `Crédito ${p.plazo_pago_dias} días` : "Crédito";
}
