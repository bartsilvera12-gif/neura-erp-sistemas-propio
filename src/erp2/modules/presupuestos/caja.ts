/**
 * Presupuesto → Caja. Lo que trae GET /api/presupuestos/[id]/conversion y cómo se pasa a
 * líneas de la caja, con los avisos que hay que mostrar ANTES de cobrar: precio de lista
 * que cambió desde que se cotizó, stock que no alcanza, productos inactivos y líneas sin
 * producto (`libres`). Desde la receta 64 un presupuesto nuevo solo lleva productos del
 * inventario: `libres` queda solo para presupuestos viejos o si el producto se borró.
 *
 * La caja vende en guaraníes: un presupuesto en US$ se pasa con SU cotización. El
 * descuento global se combina con el de cada línea en un solo % por línea (la caja lo
 * aplica igual que el presupuesto: precio × (1 − d. línea) × (1 − d. global)).
 */
import type { Cliente, Producto, TipoIva } from "@/erp2/modules/caja/lib";
import type { EstadoPresupuesto, Moneda } from "@/erp2/modules/presupuestos/tipos";

export type ProductoConversion = Producto & { activo: boolean; es_vendible: boolean };

export type ConversionPresupuesto = {
  presupuesto: {
    id: string;
    numero: string;
    revision: number;
    estado: EstadoPresupuesto;
    moneda: Moneda;
    tipo_cambio: number;
    condicion: "contado" | "credito";
    plazo_dias: number | null;
    /** Receta 106 */
    cuotas: number;
    cuotas_cada: string;
    descuento_pct: number;
    total: number;
    cliente_id: string | null;
    cliente_nombre: string;
    cliente_ruc: string | null;
    cliente_telefono: string | null;
  };
  /** el cliente del ERP (si el presupuesto es de un cliente existente) */
  cliente: Cliente | null;
  lineas: {
    item_id: string;
    descripcion: string;
    cantidad: number;
    precio_unitario: number;
    precio_lista: number | null;
    descuento_pct: number;
    tipo_iva: TipoIva;
    total_final: number;
    producto: ProductoConversion | null;
  }[];
};

export type LineaParaCaja = {
  item_id: string;
  producto: ProductoConversion;
  cantidad: number;
  tipo_iva: TipoIva;
  /** precio unitario del presupuesto en Gs. (sin descuentos) */
  precio_override: number;
  /** descuento línea + global combinados (%) */
  descuento_pct: number;
};

export type AnalisisConversion = {
  lineas: LineaParaCaja[];
  cambiosPrecio: { item_id: string; nombre: string; cotizado: number; hoy: number }[];
  faltaStock: { nombre: string; pedido: number; hay: number }[];
  inactivos: { item_id: string; nombre: string }[];
  libres: { item_id: string; descripcion: string; cantidad: number; total: number }[];
  /** total que la caja va a cobrar (Gs.), solo las líneas que pasan */
  totalCaja: number;
  enDolares: boolean;
};

/** Descuento combinado: 1 − (1 − a)(1 − b), con 6 decimales (sin ruido de coma flotante). */
export function descuentoCombinado(lineaPct: number, globalPct: number): number {
  const f = (1 - (Number(lineaPct) || 0) / 100) * (1 - (Number(globalPct) || 0) / 100);
  return Math.max(0, Math.min(99.999999, Math.round((1 - f) * 1e8) / 1e6));
}

export function analizarConversion(c: ConversionPresupuesto): AnalisisConversion {
  const { presupuesto: p } = c;
  const tc = p.moneda === "USD" ? Number(p.tipo_cambio) || 1 : 1;
  const out: AnalisisConversion = { lineas: [], cambiosPrecio: [], faltaStock: [], inactivos: [], libres: [], totalCaja: 0, enDolares: p.moneda === "USD" };
  const pedidoPorProducto = new Map<string, { nombre: string; pedido: number; hay: number; controla: boolean }>();

  for (const l of c.lineas) {
    const prod = l.producto;
    if (!prod) {
      out.libres.push({ item_id: l.item_id, descripcion: l.descripcion, cantidad: Number(l.cantidad), total: Math.round(Number(l.total_final) * tc) });
      continue;
    }
    if (!prod.activo || !prod.es_vendible) {
      out.inactivos.push({ item_id: l.item_id, nombre: prod.nombre });
      continue;
    }
    const precioGs = Math.round(Number(l.precio_unitario) * tc);
    const desc = descuentoCombinado(l.descuento_pct, p.descuento_pct);
    out.lineas.push({ item_id: l.item_id, producto: prod, cantidad: Number(l.cantidad), tipo_iva: l.tipo_iva, precio_override: precioGs, descuento_pct: desc });
    out.totalCaja += Number(l.cantidad) * Math.round(precioGs * (1 - desc / 100));

    // ¿Cambió el precio de lista desde que se cotizó? (en US$ con tolerancia de un centavo)
    if (l.precio_lista != null) {
      const listaEntonces = Number(l.precio_lista) * tc;
      const hoy = Number(prod.precio_venta) || 0;
      if (Math.abs(listaEntonces - hoy) > (p.moneda === "USD" ? tc * 0.01 : 0.5)) {
        out.cambiosPrecio.push({ item_id: l.item_id, nombre: prod.nombre, cotizado: precioGs, hoy });
      }
    }
    const acc = pedidoPorProducto.get(prod.id) ?? { nombre: prod.nombre, pedido: 0, hay: Number(prod.stock_actual) || 0, controla: prod.controla_stock };
    acc.pedido += Number(l.cantidad);
    pedidoPorProducto.set(prod.id, acc);
  }
  for (const v of pedidoPorProducto.values()) {
    if (v.controla && v.pedido > v.hay) out.faltaStock.push({ nombre: v.nombre, pedido: v.pedido, hay: v.hay });
  }
  out.totalCaja = Math.round(out.totalCaja);
  return out;
}
