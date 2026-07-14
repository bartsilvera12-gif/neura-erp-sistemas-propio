export type Naturaleza = "D" | "A";

export interface PlanCuentaItem {
  id: string;
  empresa_id: string;
  cuenta: string;
  denominacion: string;
  nivel: number;
  naturaleza: Naturaleza;
  asentable: boolean;
  centro_costo: boolean;
  moneda: string | null;
  tipo_cambio: string | null;
  cuenta_sset: string | null;
  cuenta_padre_id: string | null;
  cuenta_padre: string | null;
  tiene_hijos: boolean;
  activo: boolean;
  created_at: string;
  updated_at: string;
}

export interface PlanCuentasSummary {
  total: number;
  asentables: number;
  agrupadoras: number;
  activas: number;
  inactivas: number;
}

export interface PlanCuentasResponse {
  cuentas: PlanCuentaItem[];
  summary: PlanCuentasSummary;
  meta: { can_edit: boolean; source_table: string };
}

/** Draft del formulario Crear/Editar. */
export interface CuentaFormDraft {
  cuenta: string;
  denominacion: string;
  cuenta_padre_id: string | null;
  nivel: number;
  naturaleza: Naturaleza;
  asentable: boolean;
  centro_costo: boolean;
  moneda: string;
  tipo_cambio: string;
  cuenta_sset: string;
  activo: boolean;
}
