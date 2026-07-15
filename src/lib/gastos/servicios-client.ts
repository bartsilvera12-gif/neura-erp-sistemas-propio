import { apiFetch } from "@/lib/api/fetch-with-supabase-session";

export type IvaTipo = "exenta" | "5" | "10";
export type GastoEstado = "borrador" | "confirmado" | "anulado" | "historico";

export interface GastoItemForm {
  descripcion: string;
  cuenta_contable_id: string | null;
  subtotal: number;
  iva_tipo: IvaTipo;
}

export interface GastoHeaderForm {
  proveedor_id: string | null;
  descripcion: string | null;
  tipo_comprobante: string | null;
  numero_comprobante: string | null;
  timbrado: string | null;
  fecha_comprobante: string | null;
  fecha_contable: string | null;
  tipo_pago: "contado" | "credito" | null;
  plazo_dias: number | null;
  fecha_vencimiento: string | null;
  moneda: string | null;
  cuenta_contrapartida_id: string | null;
  items: GastoItemForm[];
}

export interface GastoItemDetalle {
  id: string;
  descripcion: string;
  cuenta_contable_id: string | null;
  cuenta_codigo: string | null;
  cuenta_denominacion: string | null;
  subtotal: number;
  iva_tipo: IvaTipo;
  monto_iva: number;
  total_linea: number;
}

export interface GastoDetalle {
  header: Record<string, unknown> & {
    id: string; estado: GastoEstado; numero: string | null;
    proveedor_id: string | null; proveedor_nombre: string | null; proveedor_ruc: string | null;
    tipo_comprobante: string | null; numero_comprobante: string | null; timbrado: string | null;
    fecha_comprobante: string | null; fecha_contable: string | null; tipo_pago: string | null;
    plazo_dias: number | null; fecha_vencimiento: string | null; moneda: string | null;
    subtotal: number | null; monto_iva: number | null; total: number | null;
    categoria: string | null; descripcion: string | null; monto: number | null;
    motivo_anulacion: string | null;
  };
  items: GastoItemDetalle[];
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

async function call<T>(url: string, init?: RequestInit): Promise<Result<T>> {
  try {
    const r = await apiFetch(url, init);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) return { ok: false, error: j?.error ?? `Error ${r.status}`, status: r.status };
    return { ok: true, data: j.data as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error de red", status: 0 };
  }
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

type GastoResult = { gasto: Record<string, unknown> };

export const getGastoDetalle = (id: string) => call<GastoDetalle>(`/api/gastos/${id}`);

/** Crea y confirma en un solo paso (con idempotencia anti doble-clic). */
export const confirmarNuevo = (h: GastoHeaderForm, idempotencyKey: string) =>
  call<GastoResult>(`/api/gastos`, jsonInit("POST", { ...h, idempotency_key: idempotencyKey }));

/** Guarda + confirma un documento existente (borrador o histórico → confirmado). */
export const confirmarExistente = (id: string, h: GastoHeaderForm) =>
  call<GastoResult>(`/api/gastos/${id}/confirmar`, jsonInit("POST", h));

export const eliminarBorrador = (id: string) => call<{ deleted: boolean }>(`/api/gastos/${id}`, { method: "DELETE" });
export const anularGasto = (id: string, motivo: string) => call<GastoResult>(`/api/gastos/${id}/anular`, jsonInit("POST", { motivo }));
