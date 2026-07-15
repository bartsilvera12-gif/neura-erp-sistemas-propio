import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { ymdInicioFinMesLocal } from "@/lib/fechas/calendario";
import { getBrowserSupabaseForEmpresaData } from "@/lib/supabase/browser-data-client";

export type GastoEstado = "borrador" | "confirmado" | "anulado" | "historico";

/** Cabecera de Gastos y Servicios (compatibilidad con consumidores previos + campos nuevos). */
export type Gasto = {
  id: string;
  empresa_id: string;
  categoria: string;
  descripcion: string;
  monto: number;
  tipo: "fijo" | "variable";
  recurrente: boolean;
  frecuencia?: string;
  fecha: string;
  created_at: string;
  // Campos Fase 1 (opcionales para compatibilidad):
  numero?: string | null;
  estado?: GastoEstado;
  proveedor_id?: string | null;
  proveedor_nombre?: string | null;
  proveedor_ruc?: string | null;
  tipo_comprobante?: string | null;
  numero_comprobante?: string | null;
  timbrado?: string | null;
  fecha_comprobante?: string | null;
  tipo_pago?: string | null;
  subtotal?: number | null;
  monto_iva?: number | null;
  total?: number | null;
};

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

export function mapRow(r: Record<string, unknown>): Gasto {
  return {
    id: r.id as string,
    empresa_id: r.empresa_id as string,
    categoria: (r.categoria as string) ?? "",
    descripcion: (r.descripcion as string) ?? "",
    monto: n(r.monto),
    tipo: (r.tipo as "fijo" | "variable") ?? "variable",
    recurrente: Boolean(r.recurrente),
    frecuencia: r.frecuencia as string | undefined,
    fecha: (r.fecha as string) ?? "",
    created_at: (r.created_at as string) ?? "",
    numero: (r.numero as string | null) ?? null,
    estado: (r.estado as GastoEstado) ?? undefined,
    proveedor_id: (r.proveedor_id as string | null) ?? null,
    proveedor_nombre: (r.proveedor_nombre as string | null) ?? null,
    proveedor_ruc: (r.proveedor_ruc as string | null) ?? null,
    tipo_comprobante: (r.tipo_comprobante as string | null) ?? null,
    numero_comprobante: (r.numero_comprobante as string | null) ?? null,
    timbrado: (r.timbrado as string | null) ?? null,
    fecha_comprobante: (r.fecha_comprobante as string | null) ?? null,
    tipo_pago: (r.tipo_pago as string | null) ?? null,
    subtotal: r.subtotal != null ? n(r.subtotal) : null,
    monto_iva: r.monto_iva != null ? n(r.monto_iva) : null,
    total: r.total != null ? n(r.total) : null,
  };
}

/** Lista de Gastos y Servicios (vía API server-side). Acepta ambas formas de respuesta. */
export async function getGastos(): Promise<Gasto[]> {
  const res = await fetchWithSupabaseSession("/api/gastos", { cache: "no-store" });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(t || `Error ${res.status}`);
  }
  const json = (await res.json()) as { success?: boolean; data?: unknown };
  if (!json.success) return [];
  const d = json.data as Record<string, unknown> | Record<string, unknown>[];
  const arr = Array.isArray(d) ? d : ((d?.gastos as Record<string, unknown>[]) ?? []);
  return arr.map(mapRow);
}

/**
 * Gastos del mes actual (Dashboard). RLS filtra por empresa. Excluye borradores y
 * anulados para no inflar totales; incluye confirmados e históricos (gastos reales).
 */
export async function getGastosMesActual(): Promise<Gasto[]> {
  const supabase = await getBrowserSupabaseForEmpresaData();
  const hoy = new Date();
  const { inicioYmd: inicioMes, finYmd: finMes } = ymdInicioFinMesLocal(hoy);

  const { data, error } = await supabase
    .from("gastos")
    .select("*")
    .gte("fecha", inicioMes)
    .lte("fecha", finMes)
    .not("estado", "in", "(borrador,anulado)")
    .order("fecha", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map(mapRow);
}
