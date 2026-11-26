/**
 * Documentos de inventario (Fase 1): traslados con nota de remisión, ajustes (AJ-) y
 * pérdidas (PE-). Tipos y etiquetas compartidas (pantallas, PDF y Excel).
 */

// ── Traslados ────────────────────────────────────────────────────────────────
export type EstadoTraslado = "en_transito" | "recibido" | "recibido_con_diferencias" | "anulado";

export const ESTADO_TRASLADO: Record<EstadoTraslado, { label: string; clase: string }> = {
  en_transito: { label: "En tránsito", clase: "bg-amber-50 text-amber-700 ring-1 ring-amber-200" },
  recibido: { label: "Recibido", clase: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" },
  recibido_con_diferencias: { label: "Recibido con diferencias", clase: "bg-orange-50 text-orange-700 ring-1 ring-orange-200" },
  anulado: { label: "Anulado", clase: "bg-slate-100 text-slate-500 ring-1 ring-slate-200" },
};

/** Motivos de traslado de la nota de remisión (códigos SIFEN). */
export const MOTIVOS_TRASLADO: [number, string][] = [
  [7, "Traslado entre locales de la empresa"],
  [1, "Traslado por ventas"],
  [2, "Traslado por consignación"],
  [4, "Traslado por compra"],
  [6, "Traslado por devolución"],
  [9, "Traslado de bienes por reparación"],
  [8, "Traslado de bienes por transformación"],
  [11, "Exhibición o demostración"],
  [12, "Participación en ferias"],
  [13, "Traslado de encomienda"],
  [3, "Exportación"],
  [5, "Importación"],
  [10, "Traslado por emisor móvil"],
  [14, "Decomiso"],
  [99, "Otro"],
];
export const motivoTraslado = (c: number) => MOTIVOS_TRASLADO.find(([k]) => k === Number(c))?.[1] ?? "Otro";

export type LoteTraslado = {
  id: string;
  lote_origen_id: string | null;
  lote_numero: string | null;
  vencimiento: string | null;
  costo_unitario: number;
  cantidad: number;
  cantidad_recibida: number | null;
  lote_destino_id: string | null;
};
export type ItemTraslado = {
  id: string;
  orden: number;
  producto_id: string;
  producto_nombre: string;
  producto_sku: string | null;
  unidad_medida: string | null;
  controla_lotes: boolean;
  cantidad: number;
  cantidad_recibida: number | null;
  costo_unitario: number;
  lotes: LoteTraslado[];
};
type Punto = { id: string; nombre: string; sucursal_id: string; sucursal: string; direccion: string | null; ciudad: string | null; telefono: string | null };
export type TrasladoDetalle = {
  id: string;
  numero: string;
  remision_numero: string;
  estado: EstadoTraslado;
  motivo_codigo: number;
  motivo_descripcion: string | null;
  fecha_inicio: string;
  fecha_fin_estimada: string | null;
  punto_partida: string | null;
  ciudad_partida: string | null;
  punto_llegada: string | null;
  ciudad_llegada: string | null;
  vehiculo_marca: string | null;
  vehiculo_chapa: string | null;
  chofer_nombre: string | null;
  chofer_documento: string | null;
  transportista_nombre: string | null;
  transportista_ruc: string | null;
  observacion: string | null;
  total_items: number;
  total_unidades: number;
  valor_costo: number;
  diferencia_unidades: number;
  diferencia_valor: number;
  diferencia_motivo: string | null;
  usuario_nombre: string | null;
  created_at: string;
  recibido_por_nombre: string | null;
  recibido_at: string | null;
  recepcion_observacion: string | null;
  anulado_por_nombre: string | null;
  anulado_at: string | null;
  anulado_motivo: string | null;
  origen: Punto & { establecimiento: string | null; punto_expedicion: string | null };
  destino: Punto;
  empresa: string | null;
  puede_recibir: boolean;
  puede_anular: boolean;
  items: ItemTraslado[];
};
export type FilaTraslado = {
  id: string;
  numero: string;
  remision_numero: string;
  estado: EstadoTraslado;
  fecha_inicio: string;
  created_at: string;
  motivo_codigo: number;
  origen: { id: string; nombre: string; sucursal: string };
  destino: { id: string; nombre: string; sucursal: string; sucursal_id: string };
  total_items: number;
  total_unidades: number;
  valor_costo: number;
  diferencia_unidades: number;
  diferencia_valor: number;
  usuario_nombre: string | null;
  recibido_at: string | null;
  recibido_por_nombre: string | null;
  anulado_at: string | null;
};

// ── Ajustes y pérdidas ───────────────────────────────────────────────────────
export type TipoAjuste = "ajuste" | "perdida";
export type EstadoAjuste = "pendiente" | "aplicado" | "rechazado" | "anulado";

export const MOTIVOS_AJUSTE: [string, string][] = [
  ["conteo_fisico", "Conteo físico"],
  ["inventario_inicial", "Inventario inicial"],
  ["correccion", "Corrección de carga"],
  ["otro", "Otro motivo"],
];
export const MOTIVOS_PERDIDA: [string, string][] = [
  ["vencimiento", "Vencimiento"],
  ["rotura", "Rotura / daño"],
  ["devolucion_cliente", "Devolución de cliente (no revendible)"],
  ["devolucion_proveedor", "Devolución al proveedor"],
  ["faltante", "Faltante / robo"],
  ["consumo_interno", "Consumo interno"],
  ["otro", "Otro motivo"],
];
const MOTIVOS_SISTEMA: [string, string][] = [["importacion", "Importación de productos"], ["apertura", "Saldo de apertura"]];
export const motivoAjuste = (m: string) =>
  [...MOTIVOS_AJUSTE, ...MOTIVOS_PERDIDA, ...MOTIVOS_SISTEMA].find(([k]) => k === m)?.[1] ?? m;

export const ESTADO_AJUSTE: Record<EstadoAjuste, { label: string; clase: string }> = {
  pendiente: { label: "Pendiente de aprobación", clase: "bg-amber-50 text-amber-700 ring-1 ring-amber-200" },
  aplicado: { label: "Aplicado", clase: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" },
  rechazado: { label: "Rechazado", clase: "bg-rose-50 text-rose-700 ring-1 ring-rose-200" },
  anulado: { label: "Anulado", clase: "bg-slate-100 text-slate-500 ring-1 ring-slate-200" },
};

export type ItemAjuste = {
  id: string;
  orden: number;
  producto_id: string;
  producto_nombre: string;
  producto_sku: string | null;
  unidad_medida: string | null;
  modo: "conteo" | "diferencia";
  cantidad_contada: number | null;
  cantidad_sistema: number | null;
  diferencia: number;
  costo_unitario: number;
  valor: number;
  lote_id: string | null;
  lote_actual: string | null;
  lote_numero: string | null;
  vencimiento: string | null;
  lotes: { lote_id: string | null; numero: string | null; vencimiento: string | null; cantidad: number }[] | null;
  nota: string | null;
};
export type AjusteDetalle = {
  id: string;
  tipo: TipoAjuste;
  numero: string;
  estado: EstadoAjuste;
  motivo: string;
  detalle: string | null;
  deposito: { id: string; nombre: string; sucursal: string };
  total_entrada: number;
  total_salida: number;
  valor_entrada: number;
  valor_salida: number;
  usuario_nombre: string | null;
  created_at: string;
  aplicado_por_nombre: string | null;
  aplicado_at: string | null;
  rechazado_por_nombre: string | null;
  rechazado_at: string | null;
  rechazado_motivo: string | null;
  anulado_por_nombre: string | null;
  anulado_at: string | null;
  anulado_motivo: string | null;
  es_admin: boolean;
  items: ItemAjuste[];
};
export type FilaAjuste = {
  id: string;
  tipo: TipoAjuste;
  numero: string;
  estado: EstadoAjuste;
  motivo: string;
  detalle: string | null;
  deposito: { id: string; nombre: string; sucursal: string };
  items: number;
  total_entrada: number;
  total_salida: number;
  valor_entrada: number;
  valor_salida: number;
  usuario_nombre: string | null;
  created_at: string;
  aplicado_por_nombre: string | null;
  aplicado_at: string | null;
};

// ── Formatos ─────────────────────────────────────────────────────────────────
export const cant = (n: number | null | undefined) => Number(n ?? 0).toLocaleString("es-PY", { maximumFractionDigits: 3 });
export const gs = (n: number | null | undefined) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;
export const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).replace(",", " ·");
export const dia = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");
