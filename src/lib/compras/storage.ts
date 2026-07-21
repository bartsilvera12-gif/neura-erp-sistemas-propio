import type { Compra } from "./types";

interface CompraApiRow {
  id: string; numero_control: string; proveedor_id: string; proveedor_nombre: string;
  producto_id: string; producto_nombre: string; cantidad: string | number; moneda: string;
  tipo_cambio: string | number; costo_unitario_original: string | number;
  costo_unitario: string | number; iva_tipo: string;
  subtotal: string | number; monto_iva: string | number; total: string | number;
  precio_venta: string | number; margen_venta: string | number | null;
  tipo_pago: string; plazo_dias: number | null; cuotas?: number | null; nro_timbrado: string; estado: string;
  numero_comprobante?: string | null;
  tipo_comprobante?: string | null;
  documento_path?: string | null;
  documento_mime?: string | null;
  cuenta_contable_id?: string | null;
  cuenta_contable_codigo?: string | null;
  cuenta_contable_denominacion?: string | null;
  fecha: string;
}

function mapRow(r: CompraApiRow): Compra {
  return {
    id: r.id,
    numero_control: r.numero_control,
    proveedor_id: r.proveedor_id,
    proveedor_nombre: r.proveedor_nombre,
    producto_id: r.producto_id,
    producto_nombre: r.producto_nombre,
    cantidad: Number(r.cantidad),
    moneda: (r.moneda === "USD" ? "USD" : "PYG") as Compra["moneda"],
    tipo_cambio: Number(r.tipo_cambio),
    costo_unitario_original: Number(r.costo_unitario_original),
    costo_unitario: Number(r.costo_unitario),
    iva_tipo: r.iva_tipo as Compra["iva_tipo"],
    subtotal: Number(r.subtotal),
    monto_iva: Number(r.monto_iva),
    total: Number(r.total),
    precio_venta: Number(r.precio_venta),
    margen_venta: r.margen_venta != null ? Number(r.margen_venta) : 0,
    tipo_pago: r.tipo_pago as Compra["tipo_pago"],
    plazo_dias: r.plazo_dias ?? undefined,
    cuotas: r.cuotas ?? undefined,
    nro_timbrado: r.nro_timbrado,
    cuenta_contable_id: r.cuenta_contable_id ?? null,
    cuenta_contable_label:
      r.cuenta_contable_codigo && r.cuenta_contable_denominacion
        ? `${r.cuenta_contable_codigo} — ${r.cuenta_contable_denominacion}`
        : null,
    numero_comprobante: r.numero_comprobante ?? null,
    tipo_comprobante: r.tipo_comprobante ?? null,
    documento_path: r.documento_path ?? null,
    fecha: r.fecha,
  };
}

export interface CuentaContableOpcion {
  id: string;
  cuenta: string;
  denominacion: string;
}

/** Cuentas activas + asentables para el selector de compras. */
export async function getCuentasContablesOpciones(): Promise<CuentaContableOpcion[]> {
  try {
    const r = await fetch("/api/plan-cuentas/opciones", { credentials: "include", cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) {
      console.error("[compras] getCuentasContablesOpciones:", (j as { error?: string })?.error ?? r.status);
      return [];
    }
    return ((j.data as { cuentas?: CuentaContableOpcion[] }).cuentas ?? []) as CuentaContableOpcion[];
  } catch (e) {
    console.error("[compras] getCuentasContablesOpciones:", e);
    return [];
  }
}

/** Edición acotada: cambia solo la cuenta contable de una compra. */
export async function updateCompraCuentaContable(
  compraId: string,
  cuentaContableId: string | null
): Promise<SaveCompraResult | SaveCompraError> {
  try {
    const r = await fetch(`/api/compras/${compraId}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cuenta_contable_id: cuentaContableId }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) {
      return { success: false, error: (j as { error?: string })?.error ?? `Error ${r.status}` };
    }
    return { success: true, compra: mapRow((j.data as { compra: CompraApiRow }).compra) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error de red" };
  }
}

export async function getCompras(): Promise<Compra[]> {
  try {
    const r = await fetch("/api/compras", { credentials: "include", cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) {
      console.error("[compras] getCompras:", (j as { error?: string })?.error ?? r.status);
      return [];
    }
    const list = ((j.data as { compras?: CompraApiRow[] }).compras ?? []) as CompraApiRow[];
    return list.map(mapRow);
  } catch (e) {
    console.error("[compras] getCompras:", e);
    return [];
  }
}

export interface SaveCompraResult {
  success: true;
  compra: Compra;
  warning?: string | null;
}
export interface SaveCompraError {
  success: false;
  error: string;
}

export async function saveCompra(
  datos: Omit<Compra, "id" | "numero_control" | "fecha">,
  idempotencyKey?: string
): Promise<SaveCompraResult | SaveCompraError> {
  try {
    const r = await fetch("/api/compras", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(idempotencyKey ? { ...datos, idempotency_key: idempotencyKey } : datos),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) {
      const err = (j as { error?: string })?.error ?? `Error ${r.status} al guardar la compra.`;
      console.error("[compras] saveCompra:", err);
      return { success: false, error: err };
    }
    const data = j.data as { compra?: CompraApiRow; warning?: string | null };
    if (!data.compra) {
      return { success: false, error: "Respuesta inválida del servidor." };
    }
    return { success: true, compra: mapRow(data.compra), warning: data.warning ?? null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error de red";
    console.error("[compras] saveCompra:", e);
    return { success: false, error: msg };
  }
}

/** Sube la foto/PDF de la factura de una compra ya creada. */
export async function uploadCompraComprobante(
  compraId: string,
  file: File
): Promise<{ ok: true; url: string | null } | { ok: false; error: string }> {
  try {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(`/api/compras/${compraId}/comprobante`, { method: "POST", credentials: "include", body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) {
      return { ok: false, error: (j as { error?: string })?.error ?? `Error ${r.status}` };
    }
    return { ok: true, url: (j.data as { documento_url?: string | null })?.documento_url ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error de red" };
  }
}

/** Obtiene una URL firmada del comprobante de una compra (o null si no tiene). */
export async function getCompraComprobante(compraId: string): Promise<{ url: string | null; mime: string | null }> {
  try {
    const r = await fetch(`/api/compras/${compraId}/comprobante`, { credentials: "include", cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) return { url: null, mime: null };
    const d = j.data as { documento_url?: string | null; documento_mime?: string | null };
    return { url: d?.documento_url ?? null, mime: d?.documento_mime ?? null };
  } catch {
    return { url: null, mime: null };
  }
}
