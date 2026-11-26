/**
 * Tipos de las respuestas de los reportes (receta 54_reportes.sql). Compartidos por las
 * páginas, las rutas de Excel y los PDF. Montos en Gs. salvo que diga lo contrario.
 */
import type { ResumenTurno } from "@/erp2/modules/caja/turno";

export type SucursalOpcion = { id: string; nombre: string; es_principal?: boolean };

// ── Dashboard ────────────────────────────────────────────────────────────────
export type KpiPeriodo = { total: number; cantidad: number; anterior: number; anterior_cantidad?: number };
export type Dashboard = {
  hoy: string;
  es_admin: boolean;
  sucursal_id: string | null;
  sucursales: SucursalOpcion[];
  kpis: { hoy: KpiPeriodo; semana: KpiPeriodo; mes: KpiPeriodo; treinta: KpiPeriodo };
  por_dia: { dia: string; total: number; cantidad: number; anterior: number; por_sucursal: Record<string, number> }[];
  por_sucursal: { id: string; nombre: string; total: number; cantidad: number }[];
  top_productos: { producto_id: string | null; nombre: string; unidades: number; monto: number; ganancia: number | null }[];
  medios: { metodo: string; label: string; total: number }[];
  margen_mes: { ventas: number; costo: number; ganancia: number } | null;
  inventario: {
    valor_stock: number | null;
    por_sucursal: { id: string; nombre: string; valor: number; unidades: number }[] | null;
    bajo_minimo: number;
    sin_stock: number;
    vencidos: { lotes: number; unidades: number; valor: number | null };
    por_vencer: { lotes: number; unidades: number; valor: number | null };
    en_transito: { cantidad: number; unidades: number; valor: number | null };
    perdidas_mes: { documentos: number; unidades: number; valor: number | null };
    perdidas_pendientes: number;
  };
  cajas_abiertas: number;
};

// ── Cierres de caja ──────────────────────────────────────────────────────────
export type CierreDia = {
  dia: string; turnos: number; abiertos: number; contado: number; credito: number; total: number; cantidad: number;
  cobros: number; egresos: number; retiros: number; ingresos: number; efectivo_esperado: number;
  diferencia: number; diferencia_otros: number; con_diferencia: number; anuladas: number; anuladas_total: number;
  sucursales: string[]; por_metodo: Record<string, number>;
};
export type CierresDias = {
  desde: string; hasta: string; sucursal_id: string | null; es_admin: boolean; sucursales: SucursalOpcion[];
  metodos: { metodo: string; label: string }[];
  dias: CierreDia[];
  totales: Omit<CierreDia, "dia" | "sucursales" | "efectivo_esperado" | "ingresos"> & { dias: number };
};

// ── Estado de cuenta ─────────────────────────────────────────────────────────
export type EstadoCuenta = {
  desde: string; hasta: string; sucursal_id: string | null; sucursales: SucursalOpcion[];
  ventas: { netas: number; iva: number; cmv: number; cantidad: number; productos_sin_costo: number };
  anuladas: { cantidad: number; total: number };
  /** Receta 103: ya restadas de las ventas (en el período en que se emitieron). */
  notas_credito: { cantidad: number; total: number };
  gastos: {
    compras: number; operativos: number; iva_credito: number; fijo: number; docs_compras: number; docs_gastos: number;
    por_rubro: { id: string | null; nombre: string; total: number }[];
  };
  perdidas: { total: number; unidades: number; pe: number; traslados: number; por_motivo: { motivo: string; label: string; valor: number }[] };
  cxc: { saldo: number; vencido: number };
  cxp: { saldo: number; vencido: number };
  flujo: { ventas_contado: number; cobros: number; compras_contado: number; gastos_contado: number; pagos_proveedores: number; devoluciones: number };
  por_mes: { mes: string; ventas: number; cmv: number; compras: number; operativos: number; perdidas: number }[];
};

// ── Proveedores ──────────────────────────────────────────────────────────────
export type ProveedorFila = {
  id: string; nombre: string; nombre_comercial: string | null; ruc: string | null; telefono: string | null; activo: boolean;
  compras: number; compras_cant: number; ultima_compra: string | null; gastos: number; gastos_cant: number;
  deuda_gs: number; vencido_gs: number; deuda_usd: number; productos: number;
};
export type Proveedores = {
  desde: string; hasta: string; sucursal_id: string | null; sucursales: SucursalOpcion[];
  rows: ProveedorFila[];
  totales: { compras: number; compras_cant: number; gastos: number; deuda_gs: number; vencido_gs: number; deuda_usd: number; proveedores_con_compras: number; compras_sin_proveedor: number };
};
export type ProveedorDetalle = {
  desde: string; hasta: string; sucursal_id: string | null; sucursales: SucursalOpcion[];
  proveedor: {
    id: string; nombre: string; nombre_comercial: string | null; ruc: string | null; telefono: string | null; email: string | null;
    contacto: string | null; ciudad: string | null; condicion_pago: string | null; plazo_pago_dias: number | null; moneda: string | null; activo: boolean;
  };
  kpis: {
    compras: number; compras_cant: number; ultima_compra: string | null; primera_compra: string | null; compras_historicas: number;
    gastos: number; deuda_gs: number; vencido_gs: number; deuda_usd: number; pagado: number;
  };
  compras: {
    id: string; numero_control: string; numero_factura: string | null; fecha: string; tipo_pago: string; moneda: string; total: number;
    total_gs: number; estado: string; sucursal_nombre: string | null; deposito_nombre: string | null; items: number; saldo: number | null;
  }[];
  productos: {
    id: string; nombre: string; sku: string | null; stock_actual: number; costo_promedio: number; precio_venta: number; activo: boolean;
    principal: boolean; ultima_compra: string | null; ultimo_costo: number | null; cantidad: number; monto: number; compras: number;
  }[];
  por_mes: { mes: string; compras: number; operativos: number }[];
  cuentas: {
    id: string; numero: string; moneda: string; monto: number; pagado: number; saldo: number; fecha_emision: string; vencimiento: string;
    estado: string; origen: "compra" | "gasto"; doc_id: string; documento: string; dias_atraso: number; saldo_gs: number;
  }[];
  pagos: { id: string; numero: string; fecha: string; moneda: string; total: number; anulado: boolean; medios: { metodo: string; monto: number }[] }[];
};

// ── Cuentas por pagar / cobrar ───────────────────────────────────────────────
export type Tramos = { al_dia: number; d1_30: number; d31_60: number; d61_90: number; d90: number };
export type CxpFila = {
  id: string; proveedor_id: string; proveedor_nombre: string; proveedor_ruc: string | null; proveedor_telefono: string | null;
  origen: "compra" | "gasto"; doc_id: string; documento: string; factura: string | null; descripcion: string;
  fecha_emision: string; vencimiento: string; moneda: string; monto: number; pagado: number; saldo: number; tc: number;
  dias_atraso: number; dias_para_vencer: number; saldo_gs: number; tramo: keyof Tramos;
};
export type CuentasPagar = {
  hoy: string; sucursal_id: string | null; sucursales: SucursalOpcion[];
  rows: CxpFila[];
  por_moneda: Record<string, Tramos & { saldo: number; saldo_gs: number; cuentas: number; vencido: number; vence_7: number }>;
  tramos_gs: Tramos & { total: number; vencido: number; compras: number; gastos: number; proveedores: number };
  por_proveedor: (Tramos & {
    id: string; nombre: string; telefono: string | null; cuentas: number; saldo_gs: number; vencido_gs: number; saldo_usd: number;
    proximo_vencimiento: string | null; max_atraso: number;
  })[];
  calendario: { desde: string; hasta: string; saldo_gs: number }[];
};
export type CxcFila = {
  id: string; cliente_id: string; cliente_nombre: string; cliente_telefono: string | null; cliente_ruc: string | null; venta_id: string;
  documento: string; origen: "credito" | "suscripcion" | "factura_contado"; fecha_emision: string; vencimiento: string;
  monto: number; cobrado: number; saldo: number; moneda: string; dias_atraso: number; dias_para_vencer: number; en_aprobacion: number;
  sucursal_nombre: string | null; tramo: keyof Tramos;
};
export type CuentasCobrar = {
  hoy: string; sucursal_id: string | null; sucursales: SucursalOpcion[];
  rows: CxcFila[];
  tramos: Tramos & { total: number; vencido: number; en_aprobacion: number; vence_7: number; clientes: number; cuentas: number };
  por_origen: { origen: CxcFila["origen"]; saldo: number; cuentas: number }[];
  por_cliente: (Tramos & {
    id: string; nombre: string; telefono: string | null; cuentas: number; saldo: number; vencido: number; en_aprobacion: number;
    max_atraso: number; proximo_vencimiento: string | null; ultimo_cobro: string | null;
  })[];
  en_aprobacion: { id: string; fecha: string; monto: number; cliente_nombre: string; documento: string; banco: string | null; operacion: string | null; creado_por: string | null }[];
  calendario: { desde: string; hasta: string; saldo: number }[];
};

// ── Ventas por mes ───────────────────────────────────────────────────────────
export type VentasMes = {
  desde: string; hasta: string; hoy: string; sucursal_id: string | null; sucursales: SucursalOpcion[];
  meses: {
    mes: string; total: number; cantidad: number; contado: number; credito: number; anterior: number; anterior_cantidad: number;
    por_sucursal: Record<string, number>; por_metodo: Record<string, number>; por_categoria: Record<string, number>;
  }[];
  metodos: { metodo: string; label: string; total: number }[];
  categorias: { id: string; nombre: string; total: number }[];
  por_sucursal: { id: string; nombre: string; total: number; cantidad: number }[];
  totales: { total: number; cantidad: number; contado: number; credito: number; anterior: number; anterior_cantidad: number };
};

// ── Pérdidas ─────────────────────────────────────────────────────────────────
export type Perdidas = {
  desde: string; hasta: string; sucursal_id: string | null; sucursales: SucursalOpcion[];
  totales: { valor: number; unidades: number; documentos: number; productos: number; pe: number; traslados: number };
  impacto: { ventas_netas: number; cmv: number; valor_inventario: number };
  pendientes: { cantidad: number; valor: number };
  por_motivo: { motivo: string; label: string; valor: number; unidades: number; documentos: number }[];
  por_producto: { id: string; nombre: string; sku: string | null; valor: number; unidades: number; motivos: string[] }[];
  por_categoria: { id: string | null; nombre: string; valor: number; unidades: number }[];
  por_deposito: { id: string; nombre: string; sucursal: string; valor: number; unidades: number }[];
  por_mes: { mes: string; valor: number; por_motivo: Record<string, number> }[];
  rows: {
    dia: string; origen: "perdida" | "traslado" | "nota_credito"; documento_id: string; documento: string; motivo: string; motivo_label: string;
    detalle: string | null; producto_id: string; producto: string; sku: string | null; deposito: string; sucursal: string; unidades: number; valor: number;
  }[];
};

// ── Un día de caja (reporte_cierre_dia = resumen_cajas_dia + detalle de cada turno) ──
export type TurnoDiaFila = {
  id: string; numero_caja: number; estado: string; punto_nombre: string; sucursal_id: string; sucursal_nombre: string;
  abierta_por_nombre: string | null; cerrada_por_nombre: string | null; fecha_apertura: string; fecha_cierre: string | null;
  monto_apertura: number; ventas_contado: number; ventas_credito: number; total_vendido: number; cantidad_ventas: number;
  cobros: number; egresos: number; retiros: number; ingresos: number; efectivo_esperado: number; efectivo_contado: number | null;
  diferencia: number | null; diferencia_otros: number | null;
};
export type CierreDiaDetalle = {
  fecha: string; sucursal_id: string | null; es_admin: boolean; sucursales: SucursalOpcion[];
  turnos: TurnoDiaFila[];
  totales: {
    turnos: number; abiertos: number; total_vendido: number; ventas_contado: number; ventas_credito: number; cantidad_ventas: number;
    cobros: number; egresos: number; retiros: number; ingresos: number; efectivo_esperado: number; diferencia: number; diferencia_otros: number;
  };
  metodos: { metodo: string; label: string; ingresos: number; egresos: number; esperado: number }[];
  por_sucursal: { sucursal_id: string; sucursal_nombre: string; turnos: number; total_vendido: number; ventas_contado: number; ventas_credito: number; efectivo_esperado: number; diferencia: number }[];
  ventas_por_metodo: { metodo: string; label: string; cantidad: number; total: number }[];
  detalle: ResumenTurno[];
};

// ── Formas de pago (reporte_formas_pago, receta 60) ─────────────────────────
export type FormaPagoFila = { metodo: string; label: string; orden: number; ventas: number; cantidad: number; costo: number; ganancia: number };
export type FormasPago = {
  desde: string; hasta: string; sucursal_id: string | null; sucursales: SucursalOpcion[];
  agrupacion: "dia" | "mes";
  medios: FormaPagoFila[];
  credito: { ventas: number; cantidad: number; costo: number; ganancia: number };
  totales: { ventas: number; contado: number; credito: number; cantidad: number; costo: number; ganancia: number; mixtas: number; productos_sin_costo: number };
  cobros: { total: number; cantidad: number; por_metodo: { metodo: string; label: string; total: number; cantidad: number }[] };
  ingresos: { metodo: string; label: string; ventas: number; cobros: number; total: number }[];
  anuladas: { cantidad: number; total: number };
  evolucion: { x: string; por_metodo: Record<string, number>; cobros: number }[];
};

export const ORIGEN_CXC: Record<string, string> = { credito: "Venta a crédito", suscripcion: "Cuota de suscripción", factura_contado: "Factura al contado" };
export const TRAMOS: { key: keyof Tramos; label: string }[] = [
  { key: "al_dia", label: "Al día" },
  { key: "d1_30", label: "1–30 días" },
  { key: "d31_60", label: "31–60 días" },
  { key: "d61_90", label: "61–90 días" },
  { key: "d90", label: "+90 días" },
];
