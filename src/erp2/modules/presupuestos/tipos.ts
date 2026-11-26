/**
 * Presupuestos: tipos, validación y cuentas compartidas por el front, la API, el PDF y
 * la vista pública. Las cuentas son las MISMAS que hace la base (presupuesto_recalcular)
 * y la caja (crear_venta): precio unitario redondeado con los descuentos aplicados y
 * línea = cantidad × ese precio. Acá solo sirven de vista previa; manda la base.
 */
import { textoCredito } from "@/erp2/modules/caja/cuotas";
import { z } from "zod";
import type { TipoIva } from "@/erp2/modules/caja/lib";

export const ROLES_PRESUPUESTOS = ["ADMIN", "SUPERVISOR", "VENDEDOR", "CAJERO"];

export type EstadoGuardado = "borrador" | "enviado" | "aceptado" | "rechazado" | "convertido";
/** "vencido" no se guarda: es borrador/enviado con la validez pasada. */
export type EstadoPresupuesto = EstadoGuardado | "vencido";
export type Moneda = "GS" | "USD";

export const ESTADOS: Record<EstadoPresupuesto, { texto: string; clase: string; punto: string }> = {
  borrador: { texto: "Borrador", clase: "bg-slate-100 text-slate-600", punto: "#94a3b8" },
  enviado: { texto: "Enviado", clase: "bg-sky-50 text-sky-700", punto: "#0ea5e9" },
  aceptado: { texto: "Aceptado", clase: "bg-emerald-50 text-emerald-700", punto: "#10b981" },
  rechazado: { texto: "Rechazado", clase: "bg-rose-50 text-rose-700", punto: "#f43f5e" },
  vencido: { texto: "Vencido", clase: "bg-amber-50 text-amber-700", punto: "#f59e0b" },
  convertido: { texto: "Convertido", clase: "bg-[var(--brand-400)]/15 text-[var(--brand)]", punto: "var(--brand)" },
};

/** Una fila de la lista (listar_presupuestos). */
export type PresupuestoFila = {
  id: string;
  numero: string;
  revision: number;
  fecha: string;
  valido_hasta: string;
  cliente_id: string | null;
  cliente_nombre: string;
  cliente_ruc: string | null;
  vendedor_id: string | null;
  vendedor_nombre: string | null;
  moneda: Moneda;
  tipo_cambio: number;
  total: number;
  estado: EstadoPresupuesto;
  vistas: number;
  enviado_at: string | null;
  venta_id: string | null;
  venta_numero: string | null;
  dias_para_vencer: number | null;
};

export type ListaPresupuestos = {
  rows: PresupuestoFila[];
  total: number;
  conteos: Record<"todos" | "abiertos" | EstadoPresupuesto, number>;
  kpis: { abiertos: number; en_negociacion: number; mes_emitidos: number; mes_convertidos: number };
};

export type PresupuestoItem = {
  id: string;
  orden: number;
  producto_id: string | null;
  sku: string | null;
  descripcion: string;
  detalle: string | null;
  unidad: string | null;
  cantidad: number;
  precio_unitario: number;
  precio_lista: number | null;
  descuento_pct: number;
  tipo_iva: TipoIva;
  total: number;
  total_final: number;
};

export type PresupuestoEvento = {
  id: string;
  tipo: string;
  canal: string | null;
  revision: number | null;
  detalle: Record<string, unknown> | null;
  usuario_nombre: string | null;
  created_at: string;
};

/** Presupuesto completo (ficha interna). */
export type Presupuesto = {
  id: string;
  numero: string;
  revision: number;
  cliente_id: string | null;
  cliente_nombre: string;
  cliente_ruc: string | null;
  cliente_telefono: string | null;
  cliente_email: string | null;
  cliente_direccion: string | null;
  fecha: string;
  validez_dias: number;
  valido_hasta: string;
  moneda: Moneda;
  tipo_cambio: number;
  condicion: "contado" | "credito";
  plazo_dias: number | null;
  /** Receta 106 */
  cuotas: number;
  cuotas_cada: string;
  vendedor_id: string | null;
  vendedor_nombre: string | null;
  descuento_pct: number;
  subtotal_bruto: number;
  descuento_lineas: number;
  descuento_global: number;
  total: number;
  total_10: number;
  iva_10: number;
  total_5: number;
  iva_5: number;
  total_exenta: number;
  total_iva: number;
  condiciones: string | null;
  notas_internas: string | null;
  estado: EstadoPresupuesto;
  /** el guardado (sin "vencido") */
  estado_guardado: EstadoGuardado;
  enviado_at: string | null;
  aceptado_at: string | null;
  aceptado_por: string | null;
  rechazado_at: string | null;
  rechazado_por: string | null;
  rechazo_motivo: string | null;
  convertido_at: string | null;
  venta_id: string | null;
  venta_numero?: string | null;
  token: string;
  vistas: number;
  visto_at: string | null;
  ultima_vista_at: string | null;
  created_at: string;
  updated_at: string;
  items: PresupuestoItem[];
  eventos: PresupuestoEvento[];
};

export const COLS_PRESUPUESTO =
  "id, numero, revision, cliente_id, cliente_nombre, cliente_ruc, cliente_telefono, cliente_email, cliente_direccion, fecha, validez_dias, valido_hasta, moneda, tipo_cambio, condicion, plazo_dias, cuotas, cuotas_cada, vendedor_id, vendedor_nombre, descuento_pct, subtotal_bruto, descuento_lineas, descuento_global, total, total_10, iva_10, total_5, iva_5, total_exenta, total_iva, condiciones, notas_internas, estado, enviado_at, aceptado_at, aceptado_por, rechazado_at, rechazado_por, rechazo_motivo, convertido_at, venta_id, token, vistas, visto_at, ultima_vista_at, created_at, updated_at";
export const COLS_ITEM =
  "id, orden, producto_id, sku, descripcion, detalle, unidad, cantidad, precio_unitario, precio_lista, descuento_pct, tipo_iva, total, total_final";

/** El documento que ve el cliente (PDF y link público): solo campos públicos. */
export type PresupuestoDoc = {
  numero: string;
  revision: number;
  fecha: string;
  valido_hasta: string;
  validez_dias: number;
  estado: EstadoPresupuesto;
  moneda: Moneda;
  tipo_cambio: number;
  condicion: "contado" | "credito";
  plazo_dias: number | null;
  cuotas: number;
  cuotas_cada: string;
  vendedor_nombre: string | null;
  cliente: { nombre: string; ruc: string | null; telefono: string | null; email: string | null; direccion: string | null };
  condiciones: string | null;
  descuento_pct: number;
  subtotal_bruto: number;
  descuento_lineas: number;
  descuento_global: number;
  total: number;
  total_10: number;
  iva_10: number;
  total_5: number;
  iva_5: number;
  total_exenta: number;
  total_iva: number;
  aceptado_at: string | null;
  rechazado_at: string | null;
  rechazo_motivo: string | null;
  items: { descripcion: string; detalle: string | null; sku: string | null; unidad: string | null; cantidad: number; precio_unitario: number; descuento_pct: number; tipo_iva: TipoIva; total: number }[];
};

export type PresupuestoPublico =
  | (PresupuestoDoc & { expirado: false; permite_responder: boolean })
  | { expirado: true; numero: string; valido_hasta: string; vendedor_nombre: string | null };

export type ConfigPresupuestos = { validez_dias: number; condiciones: string | null; respuesta_online: boolean };
export const CONFIG_DEFECTO: ConfigPresupuestos = { validez_dias: 15, condiciones: null, respuesta_online: true };

// ── Validación del alta / edición ─────────────────────────────────────────────
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");
const texto = (max: number) => z.string().trim().max(max).nullish();

export const cuerpoPresupuesto = z.object({
  idempotency_key: z.string().uuid().nullish(),
  cliente_id: z.string().uuid().nullish(),
  cliente_nombre: texto(200),
  cliente_ruc: texto(40),
  cliente_telefono: texto(40),
  cliente_email: texto(160),
  cliente_direccion: texto(300),
  fecha: fecha.nullish(),
  validez_dias: z.coerce.number().int().min(1).max(365).nullish(),
  valido_hasta: fecha.nullish(),
  moneda: z.enum(["GS", "USD"]).default("GS"),
  tipo_cambio: z.coerce.number().positive().nullish(),
  condicion: z.enum(["contado", "credito"]).default("contado"),
  plazo_dias: z.coerce.number().int().min(1).max(3650).nullish(),
  cuotas: z.coerce.number().int().min(1).max(60).default(1),
  cuotas_cada: z.enum(["mes", "quincena", "semana"]).default("mes"),
  vendedor_id: z.string().uuid().nullish(),
  descuento_pct: z.coerce.number().min(0).max(99.99).default(0),
  condiciones: texto(4000),
  notas_internas: texto(4000),
  items: z
    .array(
      z.object({
        // Solo productos del inventario (receta 64): sin líneas libres.
        producto_id: z.string({ error: "En un presupuesto solo van productos del inventario" })
          .uuid("En un presupuesto solo van productos del inventario"),
        descripcion: texto(300),
        detalle: texto(1000),
        cantidad: z.coerce.number().positive("La cantidad tiene que ser mayor a 0"),
        precio_unitario: z.coerce.number().positive("Falta el precio de alguna línea"),
        descuento_pct: z.coerce.number().min(0).max(99.99).default(0),
      }),
    )
    .min(1, "El presupuesto no tiene líneas")
    .max(300, "Máximo 300 líneas"),
});
export type CuerpoPresupuesto = z.infer<typeof cuerpoPresupuesto>;

export const cuerpoAccion = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("enviar"), canal: z.enum(["whatsapp", "link", "email", "manual"]) }),
  z.object({ accion: z.literal("aceptar") }),
  z.object({ accion: z.literal("rechazar"), motivo: z.string().trim().min(1, "Escribí el motivo del rechazo").max(500) }),
  z.object({ accion: z.literal("reabrir") }),
  z.object({ accion: z.literal("duplicar") }),
  z.object({ accion: z.literal("vincular_producto"), item_id: z.string().uuid(), producto_id: z.string().uuid() }),
]);

export const cuerpoConfig = z.object({
  validez_dias: z.coerce.number().int().min(1, "Mínimo 1 día").max(365, "Máximo 365 días"),
  condiciones: z.string().trim().max(4000).nullish(),
  respuesta_online: z.boolean().default(true),
});

// ── Cuentas (mismo redondeo que la base) ──────────────────────────────────────
export const decimales = (m: Moneda) => (m === "USD" ? 2 : 0);

/** Redondeo "mitad lejos del cero" como numeric de Postgres, sin errores de coma flotante. */
export function redondear(x: number, dec: number): number {
  if (!Number.isFinite(x) || Math.abs(x) < 1e-6) return 0;
  const s = x < 0 ? -1 : 1;
  // "1.7355e2" en vez de 1.7355 * 100 (= 173.54999…): corre la coma sin error binario.
  const r = Math.round(Number(`${Math.abs(x)}e${dec}`) + 1e-9);
  return s * Number(`${r}e-${dec}`);
}

export type LineaCalculo = { cantidad: number; precio_unitario: number; descuento_pct: number; tipo_iva: TipoIva };

export function calcularLinea(l: LineaCalculo, descuentoGlobal: number, moneda: Moneda) {
  const d = decimales(moneda);
  const fl = 1 - (Number(l.descuento_pct) || 0) / 100;
  const fg = 1 - (Number(descuentoGlobal) || 0) / 100;
  const cant = Number(l.cantidad) || 0;
  const precio = redondear(Number(l.precio_unitario) || 0, d);
  return {
    bruto: redondear(cant * precio, d),
    total: redondear(cant * redondear(precio * fl, d), d),
    total_final: redondear(cant * redondear(precio * fl * fg, d), d),
  };
}

export function calcularTotales(lineas: LineaCalculo[], descuentoGlobal: number, moneda: Moneda) {
  const d = decimales(moneda);
  let bruto = 0, neto = 0, final = 0, t10 = 0, t5 = 0, tex = 0;
  for (const l of lineas) {
    const c = calcularLinea(l, descuentoGlobal, moneda);
    bruto += c.bruto;
    neto += c.total;
    final += c.total_final;
    if (l.tipo_iva === "10%") t10 += c.total_final;
    else if (l.tipo_iva === "5%") t5 += c.total_final;
    else tex += c.total_final;
  }
  const r = (v: number) => redondear(v, d);
  const iva10 = r(t10 / 11), iva5 = r(t5 / 21);
  return {
    subtotal_bruto: r(bruto),
    descuento_lineas: r(bruto - neto),
    descuento_global: r(neto - final),
    total: r(final),
    total_10: r(t10), iva_10: iva10,
    total_5: r(t5), iva_5: iva5,
    total_exenta: r(tex),
    total_iva: r(iva10 + iva5),
  };
}

/** Estado que se muestra (vencido = borrador/enviado con la validez pasada). `hoy` = YYYY-MM-DD de Asunción. */
export function estadoEfectivo(estado: EstadoGuardado, validoHasta: string, hoy: string): EstadoPresupuesto {
  return (estado === "borrador" || estado === "enviado") && validoHasta < hoy ? "vencido" : estado;
}

// ── Formato ────────────────────────────────────────────────────────────────────
export function monto(v: number | string | null | undefined, moneda: Moneda = "GS"): string {
  const n = Number(v) || 0;
  return moneda === "USD"
    ? `US$ ${n.toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `Gs. ${Math.round(n).toLocaleString("es-PY")}`;
}
export const cantidad = (n: number | string) => Number(n).toLocaleString("es-PY", { maximumFractionDigits: 3 });
export const pct = (n: number | string) => `${Number(n).toLocaleString("es-PY", { maximumFractionDigits: 2 })}%`;
/** "2026-10-15" → "15/10/2026" */
export const diaCorto = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");
export const numeroConRevision = (numero: string, revision: number) => (revision > 1 ? `${numero} rev ${revision}` : numero);
export const nombreArchivoPresupuesto = (numero: string, revision: number) =>
  `presupuesto-${numero}${revision > 1 ? `-rev${revision}` : ""}.pdf`;
/** "Contado" · "Crédito a 30 días" · "Crédito · 3 cuotas mensuales (1ª a 30 días)". */
export const condicionTexto = (c: "contado" | "credito", plazo: number | null, cuotas?: number | null, cada?: string | null) =>
  c !== "credito" ? "Contado" : Number(cuotas) > 1 ? textoCredito(plazo, cuotas, cada) : `Crédito${plazo ? ` a ${plazo} días` : ""}`;
