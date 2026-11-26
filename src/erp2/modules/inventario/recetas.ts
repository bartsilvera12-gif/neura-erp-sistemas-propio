/**
 * Recetas (receta 72): tipos y cálculos compartidos por la pantalla /inventario/recetas y su editor.
 * Receta 97: productos Fabricados y preparaciones "por tanda" (tienen stock; se fabrican en
 * Inventario › Producción).
 *
 * Merma: la cantidad de cada ingrediente es la NETA (lo que va al plato); se descuenta la BRUTA:
 *   bruto = neto / (1 − merma %)   (150 g de carne con 10 % de merma descuenta 166,7 g)
 * Rendimiento: cuántas unidades produce la receta (porciones del plato, o kg / l / unidades de una
 * preparación). Costo por unidad = Σ costo de las líneas ÷ rendimiento. Igual que en la base.
 */

export type EstadoReceta = "completa" | "sin_receta" | "faltante";

export type FilaReceta = {
  id: string;
  nombre: string;
  sku: string;
  tipo: "menu" | "preparacion";
  /** Receta 97: se fabrica por tanda (Fabricado, o preparación con stock propio). */
  por_tanda?: boolean;
  /** Receta 97: stock propio en el depósito del usuario (por tanda). */
  stock?: number;
  /** Receta 97: cuánto se puede fabricar con las materias primas del depósito (null = sin límite). */
  alcanza?: number | null;
  unidad_medida: string;
  precio_venta: number;
  descuento_pct: number | null;
  imagen_url: string | null;
  rendimiento: number;
  ingredientes: number;
  costo: number | null;
  porciones: number | null;
  faltan: string | null;
  estado: EstadoReceta;
  /** Receta 73: quitables + extras + grupos de opciones. */
  modificadores?: number;
  /** Receta 74: costo con la opción más barata / más cara de los grupos obligatorios con ingredientes (null = no hay). */
  costo_desde?: number | null;
  costo_hasta?: number | null;
};

export type ListaRecetas = { deposito_id: string | null; deposito: string | null; items: FilaReceta[] };

export type IngredienteReceta = {
  insumo_id: string;
  nombre: string;
  sku: string;
  unidad_insumo: string;
  cantidad: number;
  unidad: string;
  merma_pct: number;
  es_preparacion: boolean;
  costo_unitario: number;
  stock: number;
  controla_stock: boolean;
  activo: boolean;
  /** Receta 97: el ingrediente se fabrica por tanda (se usa su stock, no su receta). */
  por_tanda?: boolean;
  /** Receta 73: el cliente lo puede pedir "sin …" (no se descuenta). */
  se_puede_quitar?: boolean;
};

/** Extra activado en un plato (receta 73). `precio` null = el de la lista común. */
export type ExtraPlato = {
  extra_id: string; nombre: string; precio_lista: number; precio: number | null; maximo: number; activo: boolean;
  insumo_nombre: string; cantidad: number; unidad: string; disponible?: number;
};

/** Ingrediente de una opción (receta 74): por plato, sin rendimiento; mismos campos que la receta. */
export type IngredienteOpcion = Omit<IngredienteReceta, "se_puede_quitar">;

/** Grupo de opciones del plato (receta 73). Receta 74: cada opción con sus ingredientes y su costo. */
export type GrupoOpciones = {
  id?: string; nombre: string; obligatorio: boolean; minimo: number; maximo: number;
  opciones: { id?: string; nombre: string; precio: number; activo: boolean; items?: IngredienteOpcion[]; costo?: number; disponible?: boolean }[];
};

/** Extra de la lista común (Inventario › Recetas › Extras). */
export type ExtraComun = {
  id: string; nombre: string; insumo_id: string; insumo_nombre: string; insumo_sku: string; unidad_insumo: string;
  es_preparacion: boolean; cantidad: number; unidad: string; precio: number; activo: boolean; insumo_activo: boolean;
  costo: number; alcanza: number | null; platos: number;
};

export type DetalleReceta = {
  producto: {
    id: string; nombre: string; sku: string; tipo_producto: "menu" | "materia_prima" | "reventa"; unidad_medida: string;
    precio_venta: number; descuento_pct: number | null; imagen_url: string | null; stock_actual: number; activo: boolean;
    controla_lotes?: boolean;
  };
  tiene_receta: boolean;
  /** Receta 97: se fabrica por tanda (Fabricado siempre; preparación a elección). */
  por_tanda?: boolean;
  /** Receta 97: stock propio en el depósito del usuario. */
  stock?: number;
  /** Receta 97: cuánto se puede fabricar con las materias primas del depósito (solo por tanda). */
  alcanza_fabricar?: number | null;
  rendimiento: number;
  notas: string | null;
  costo: number;
  /** Receta 74: costo base + opción más barata / más cara de los grupos obligatorios con ingredientes. */
  costo_rango?: { desde: number; hasta: number } | null;
  porciones: number | null;
  items: IngredienteReceta[];
  usado_en: { id: string; nombre: string }[];
  /** Receta 73 (solo platos Menú). */
  extras?: ExtraPlato[];
  grupos?: GrupoOpciones[];
};

/** Magnitud de una unidad y su factor a la unidad base (g, ml, unidad). */
const UNIDADES: Record<string, { dim: "masa" | "volumen" | "unidad"; factor: number }> = {
  kg: { dim: "masa", factor: 1000 },
  g: { dim: "masa", factor: 1 },
  l: { dim: "volumen", factor: 1000 },
  ml: { dim: "volumen", factor: 1 },
  Unidad: { dim: "unidad", factor: 1 },
};

/** Unidades en las que se puede cargar un ingrediente que se mide en `unidadInsumo`. */
export function unidadesCompatibles(unidadInsumo: string): string[] {
  const d = UNIDADES[unidadInsumo]?.dim ?? "unidad";
  return d === "masa" ? ["g", "kg"] : d === "volumen" ? ["ml", "l"] : ["Unidad"];
}

/** Unidad sugerida al agregar un ingrediente (en las recetas se piensa en g y ml). */
export const unidadSugerida = (unidadInsumo: string) => (unidadInsumo === "kg" ? "g" : unidadInsumo === "l" ? "ml" : unidadInsumo in UNIDADES ? unidadInsumo : "Unidad");

export function convertir(cant: number, de: string, a: string): number {
  const x = UNIDADES[de], y = UNIDADES[a];
  if (!x || !y || x.dim !== y.dim) return cant;
  return (cant * x.factor) / y.factor;
}

/** Cantidad bruta (con merma) en la unidad del ingrediente. */
export function brutoEnUnidadInsumo(cantidad: number, unidad: string, merma: number, unidadInsumo: string): number {
  const m = Math.min(90, Math.max(0, merma || 0));
  return convertir((cantidad || 0) / (1 - m / 100), unidad, unidadInsumo);
}

export const numero = (v: string) => {
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

export const cant = (n: number, max = 3) => Number(n || 0).toLocaleString("es-PY", { maximumFractionDigits: max });
export const unidadCorta = (u: string) => (u === "Unidad" ? "u." : u);
export const gs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
export const precioFinal = (precio: number, desc: number | null) => Math.round((Number(precio) || 0) * (1 - Math.min(100, Math.max(0, Number(desc) || 0)) / 100));
export const margenPct = (costo: number, precio: number) => (precio > 0 ? ((precio - costo) / precio) * 100 : null);
export const colorMargen = (m: number | null) => (m == null ? "text-slate-400" : m >= 60 ? "text-emerald-600" : m >= 35 ? "text-amber-600" : "text-rose-600");

export const ESTADOS_RECETA: Record<EstadoReceta, { label: string; chip: string }> = {
  completa: { label: "Completa", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  sin_receta: { label: "Sin receta", chip: "bg-slate-100 text-slate-600 ring-slate-200" },
  faltante: { label: "Falta ingrediente", chip: "bg-rose-50 text-rose-700 ring-rose-200" },
};
