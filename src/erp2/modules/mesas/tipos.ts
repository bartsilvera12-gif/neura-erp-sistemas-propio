/**
 * Mesas con QR y pedidos (receta 68). Tipos y helpers compartidos por Configuración › Mesas,
 * Caja › Pedidos de mesas, Cocina y el menú público /m/<token>.
 */
import type { ModsSnapshot } from "@/erp2/modules/mesas/modificadores";

export const TOKEN_MESA_RE = /^[0-9a-f]{64}$/;
export const SEGUIMIENTO_RE = /^[0-9a-f]{32}$/;

export type EstadoPedido = "nuevo" | "aceptado" | "en_preparacion" | "listo" | "entregado" | "rechazado";

export const ESTADOS_PEDIDO: Record<EstadoPedido, { texto: string; clase: string; cliente: string }> = {
  nuevo: { texto: "Nuevo", clase: "bg-amber-100 text-amber-800", cliente: "Enviado: esperando que la caja lo confirme" },
  aceptado: { texto: "Aceptado", clase: "bg-sky-100 text-sky-800", cliente: "Confirmado: ya pasó a la cocina" },
  en_preparacion: { texto: "En preparación", clase: "bg-violet-100 text-violet-800", cliente: "Lo están preparando" },
  listo: { texto: "Listo", clase: "bg-emerald-100 text-emerald-800", cliente: "¡Listo! Ya te lo llevan" },
  entregado: { texto: "Entregado", clase: "bg-slate-100 text-slate-600", cliente: "Entregado. ¡Buen provecho!" },
  rechazado: { texto: "Rechazado", clase: "bg-rose-100 text-rose-700", cliente: "No se pudo tomar el pedido" },
};

export type Mesa = {
  id: string;
  sucursal_id: string;
  sucursal_nombre: string;
  nombre: string;
  zona: string | null;
  token: string;
  activa: boolean;
  orden: number;
  cuenta_abierta: boolean;
};

export type MesasConfig = {
  mesas: Mesa[];
  sucursales: { id: string; nombre: string }[];
  empresa: string | null;
  /** Dirección que llevan los QR (la arma el servidor; nunca "localhost"). */
  base_menu?: string;
};

/** Receta 70: `estacion_id` = estación resuelta al aceptar (null = Cocina general). Receta 73: modificadores de la línea. */
export type ItemPedido = {
  nombre: string; cantidad: number; precio_unitario: number; total: number; nota: string | null; estacion_id?: string | null;
  modificadores?: ModsSnapshot | null; modificadores_texto?: string | null;
};

/** Estación de cocina (receta 70): Plancha, Pizzería, Barra… */
export type Estacion = { id: string; nombre: string; color: string | null; icono: string | null; orden: number; activa: boolean };

export type EstadoComanda = "aceptado" | "en_preparacion" | "listo" | "entregado";

export const ESTADOS_COMANDA: Record<EstadoComanda, { texto: string; clase: string }> = {
  aceptado: { texto: "para preparar", clase: "bg-sky-100 text-sky-800" },
  en_preparacion: { texto: "en preparación", clase: "bg-violet-100 text-violet-800" },
  listo: { texto: "listo", clase: "bg-emerald-100 text-emerald-800" },
  entregado: { texto: "entregado", clase: "bg-slate-100 text-slate-500" },
};

/** La parte de un pedido que hace UNA estación (receta 70). */
export type Comanda = {
  id: string;
  estacion_id: string | null;
  estacion_nombre: string;
  color: string | null;
  icono: string | null;
  estado: EstadoComanda;
  creado_at: string;
  preparando_at: string | null;
  listo_at: string | null;
  entregado_at: string | null;
  impresa_at: string | null;
};

/** Nombre de la estación con su ícono: "🔥 Plancha" · "Cocina general". */
export const nombreEstacion = (c: { icono: string | null; estacion_nombre?: string; nombre?: string }) =>
  [c.icono, c.estacion_nombre ?? c.nombre].filter(Boolean).join(" ");

/** Ítems de un pedido que le tocan a una comanda. */
export const itemsDeComanda = (p: PedidoMesa, k: Comanda) => p.items.filter((i) => (i.estacion_id ?? null) === k.estacion_id);

export type PedidoMesa = {
  id: string;
  numero: number;
  estado: EstadoPedido;
  cuenta_id: string;
  mesa: { id: string; nombre: string; zona: string | null };
  sucursal: { id: string; nombre: string };
  nombre_cliente: string | null;
  nota: string | null;
  total: number;
  creado_at: string;
  aceptado_at: string | null;
  aceptado_por_nombre: string | null;
  rechazado_at: string | null;
  motivo_rechazo: string | null;
  preparando_at: string | null;
  listo_at: string | null;
  entregado_at: string | null;
  items: ItemPedido[];
  /** Receta 70: una por estación (vacío mientras el pedido es nuevo o si se rechazó). */
  comandas?: Comanda[];
};

export type CuentaMesa = {
  id: string;
  abierta_at: string;
  /** Receta 69: "en_caja" = se envió a caja y espera que la cobren (sigue sumando pedidos aceptados). */
  estado: "abierta" | "en_caja";
  en_caja_at: string | null;
  en_caja_por_nombre: string | null;
  mesa: { id: string; nombre: string; zona: string | null };
  sucursal: { id: string; nombre: string };
  total: number;
  pedidos: number;
  pendientes: number;
  items: { nombre: string; cantidad: number; precio_unitario: number; total: number; modificadores_texto?: string | null }[];
  /** Receta 88: la mesa pidió la cuenta desde el QR (null = no / ya se canceló). */
  solicitada_at?: string | null;
  /** Receta 88: la cuenta separada desde el celular (null = se cobra junta). */
  division?: DivisionCuenta | null;
  /** Receta 88: datos de facturación propuestos para la cuenta entera. */
  facturacion?: FacturacionPropuesta | null;
};

/** Datos de facturación que propuso la mesa (receta 88). `cliente` = el que ya tiene ese RUC. */
export type FacturacionPropuesta = { ruc: string; razon_social: string; email: string | null; cliente: { id: string; nombre: string } | null };

/** División de la cuenta como la ve el tablero (receta 88). */
export type DivisionCuenta = {
  modo: "productos" | "iguales";
  personas: number;
  actualizada_at: string;
  partes: { id: string; numero: number; nombre: string; es_resto: boolean; total: number; cobrada: boolean; cobrada_at: string | null; facturacion: FacturacionPropuesta | null }[];
  resto: { total: number } | null;
};

export type TableroMesas = {
  ahora: string;
  pedidos: PedidoMesa[];
  cuentas: CuentaMesa[];
  /** Receta 70: estaciones de la empresa (activas e inactivas) y la estación fija del usuario. */
  estaciones?: Estacion[];
  mi_estacion_id?: string | null;
  puede_atender: boolean;
  puede_cocina: boolean;
};

export const URL_TABLERO = "/api/mesas/tablero";

/** Cuenta enviada a caja, como la ve Caja › Nueva venta (receta 69). */
export type CuentaPorCobrar = {
  id: string;
  abierta_at: string;
  en_caja_at: string;
  en_caja_por_nombre: string | null;
  /** Cambia si se acepta / rechaza un pedido: la caja cobra la versión que cargó. */
  version: string;
  mesa: { id: string; nombre: string; zona: string | null };
  total: number;
  pendientes: number;
  items: {
    producto_id: string | null; nombre: string; cantidad: number; precio_unitario: number; total: number; precio_de_hoy: boolean;
    /** Receta 73: modificadores de la línea; precio_base = precio_unitario sin los modificadores. */
    modificadores?: ModsSnapshot | null; modificadores_texto?: string | null; precio_mods?: number; precio_base?: number;
  }[];
  /** Receta 88: facturación propuesta por la mesa, lo ya cobrado por partes y la división. */
  facturacion?: FacturacionPropuesta | null;
  cobrado?: number;
  division?: {
    modo: "productos" | "iguales";
    partes: ParteParaCobrar[];
    resto: { total: number; items: LineaPorCobrar[] } | null;
  } | null;
};

export type LineaPorCobrar = CuentaPorCobrar["items"][number];

/** Una parte de la cuenta separada (receta 88): se cobra sola, con su venta. */
export type ParteParaCobrar = {
  id: string; numero: number; nombre: string; es_resto: boolean; cobrada: boolean; total: number;
  items: LineaPorCobrar[]; facturacion: FacturacionPropuesta | null;
};

export type MesasPorCobrar = { ahora: string; caja_id?: string; cuentas: CuentaPorCobrar[] };

export const urlPorCobrar = (cajaId: string) => `/api/mesas/por-cobrar?caja=${cajaId}`;

/** "Mesa 4 · Patio · Casa central" */
export function origenPedido(p: { mesa: { nombre: string; zona: string | null }; sucursal?: { nombre: string } }, conSucursal = true): string {
  return [p.mesa.nombre, p.mesa.zona, conSucursal ? p.sucursal?.nombre : null].filter(Boolean).join(" · ");
}

/** "hace 3 min" respecto de `ahora` (la hora del servidor, para no depender del reloj del equipo). */
export function haceCuanto(iso: string, ahora: number = Date.now()): string {
  const s = Math.max(0, Math.round((ahora - Date.parse(iso)) / 1000));
  if (s < 45) return "recién";
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  return `hace ${h} h ${m % 60 ? `${m % 60} min` : ""}`.trim();
}

export const horaCorta = (iso: string) =>
  new Intl.DateTimeFormat("es-PY", { timeZone: "America/Asuncion", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

export const gs = (n: number) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;

export const cant = (n: number) => Number(n).toLocaleString("es-PY", { maximumFractionDigits: 3 });

/** Link del menú de una mesa (el que va en el QR). */
export function linkMesa(token: string, origen?: string): string {
  const base = origen ?? (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}/m/${token}`;
}

/** Pitido corto (WebAudio, sin archivos) para avisar que llegó un pedido. */
export function pitido() {
  try {
    const W = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctx = W.AudioContext ?? W.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const tono = (frec: number, desde: number, dura: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = frec;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + desde);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + desde + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + desde + dura);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + desde);
      o.stop(ctx.currentTime + desde + dura + 0.05);
    };
    tono(880, 0, 0.18);
    tono(1320, 0.2, 0.25);
    setTimeout(() => void ctx.close().catch(() => {}), 1000);
  } catch {
    /* sin audio: queda el aviso visual */
  }
}
