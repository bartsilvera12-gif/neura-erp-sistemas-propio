import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

export type Naturaleza = "D" | "A";

/** Fila tal como vive en `neura.plan_cuentas`. */
export interface PlanCuentaRow {
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
  activo: boolean;
  created_at: string;
  updated_at: string;
}

/** Fila enriquecida para la UI (código del padre + si tiene hijos). */
export interface PlanCuentaItem extends PlanCuentaRow {
  cuenta_padre: string | null;
  tiene_hijos: boolean;
}

export interface PlanCuentasSummary {
  total: number;
  asentables: number;
  agrupadoras: number;
  activas: number;
  inactivas: number;
}

const SELECT_COLS =
  "id, empresa_id, cuenta, denominacion, nivel, naturaleza, asentable, centro_costo, moneda, tipo_cambio, cuenta_sset, cuenta_padre_id, activo, created_at, updated_at";

const NATURALEZAS: Naturaleza[] = ["D", "A"];

export class PlanCuentaValidationError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function asTextOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function requireText(v: unknown, field: string): string {
  const s = v === null || v === undefined ? "" : String(v).trim();
  if (!s) throw new PlanCuentaValidationError(`El campo "${field}" es obligatorio.`);
  return s;
}

function toBool(v: unknown, def = false): boolean {
  if (v === null || v === undefined) return def;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  return ["true", "1", "si", "sí", "s", "yes", "y"].includes(s);
}

/** Payload validado para crear. */
export interface PlanCuentaCreate {
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
  activo: boolean;
}

export function parsePlanCuentaCreate(body: unknown): PlanCuentaCreate {
  const b = (body ?? {}) as Record<string, unknown>;
  const cuenta = requireText(b.cuenta, "Código");
  const denominacion = requireText(b.denominacion, "Denominación");
  const nivelRaw = b.nivel;
  const nivel = Number(nivelRaw);
  if (!Number.isInteger(nivel) || nivel < 1) {
    throw new PlanCuentaValidationError('El campo "Nivel" debe ser un entero ≥ 1.');
  }
  const naturaleza = String(b.naturaleza ?? "").trim().toUpperCase() as Naturaleza;
  if (!NATURALEZAS.includes(naturaleza)) {
    throw new PlanCuentaValidationError('La "Naturaleza" debe ser D (deudora) o A (acreedora).');
  }
  return {
    cuenta,
    denominacion,
    nivel,
    naturaleza,
    asentable: toBool(b.asentable, false),
    centro_costo: toBool(b.centro_costo, false),
    moneda: asTextOrNull(b.moneda),
    tipo_cambio: asTextOrNull(b.tipo_cambio),
    cuenta_sset: asTextOrNull(b.cuenta_sset),
    cuenta_padre_id: asTextOrNull(b.cuenta_padre_id),
    activo: toBool(b.activo, true),
  };
}

/** Payload validado para editar (campos presentes se aplican). */
export type PlanCuentaUpdate = Partial<PlanCuentaCreate>;

export function parsePlanCuentaUpdate(body: unknown): PlanCuentaUpdate {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: PlanCuentaUpdate = {};
  if ("cuenta" in b) out.cuenta = requireText(b.cuenta, "Código");
  if ("denominacion" in b) out.denominacion = requireText(b.denominacion, "Denominación");
  if ("nivel" in b) {
    const nivel = Number(b.nivel);
    if (!Number.isInteger(nivel) || nivel < 1) {
      throw new PlanCuentaValidationError('El campo "Nivel" debe ser un entero ≥ 1.');
    }
    out.nivel = nivel;
  }
  if ("naturaleza" in b) {
    const naturaleza = String(b.naturaleza ?? "").trim().toUpperCase() as Naturaleza;
    if (!NATURALEZAS.includes(naturaleza)) {
      throw new PlanCuentaValidationError('La "Naturaleza" debe ser D (deudora) o A (acreedora).');
    }
    out.naturaleza = naturaleza;
  }
  if ("asentable" in b) out.asentable = toBool(b.asentable, false);
  if ("centro_costo" in b) out.centro_costo = toBool(b.centro_costo, false);
  if ("moneda" in b) out.moneda = asTextOrNull(b.moneda);
  if ("tipo_cambio" in b) out.tipo_cambio = asTextOrNull(b.tipo_cambio);
  if ("cuenta_sset" in b) out.cuenta_sset = asTextOrNull(b.cuenta_sset);
  if ("cuenta_padre_id" in b) out.cuenta_padre_id = asTextOrNull(b.cuenta_padre_id);
  if ("activo" in b) out.activo = toBool(b.activo, true);
  return out;
}

/** Lee todas las cuentas de la empresa (base para UI y validaciones jerárquicas). */
export async function listPlanCuentas(
  supabase: AppSupabaseClient,
  empresaId: string
): Promise<PlanCuentaItem[]> {
  const { data, error } = await supabase
    .from("plan_cuentas")
    .select(SELECT_COLS)
    .eq("empresa_id", empresaId)
    .order("cuenta", { ascending: true });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as PlanCuentaRow[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const parentIds = new Set(rows.map((r) => r.cuenta_padre_id).filter(Boolean) as string[]);
  return rows.map((r) => ({
    ...r,
    cuenta_padre: r.cuenta_padre_id ? byId.get(r.cuenta_padre_id)?.cuenta ?? null : null,
    tiene_hijos: parentIds.has(r.id),
  }));
}

export function summarize(rows: PlanCuentaItem[]): PlanCuentasSummary {
  return {
    total: rows.length,
    asentables: rows.filter((r) => r.asentable).length,
    agrupadoras: rows.filter((r) => !r.asentable).length,
    activas: rows.filter((r) => r.activo).length,
    inactivas: rows.filter((r) => !r.activo).length,
  };
}

/** Descendientes (transitivos) de un id, para evitar ciclos al mover el padre. */
export function collectDescendants(rows: PlanCuentaRow[], rootId: string): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.cuenta_padre_id) continue;
    const arr = childrenByParent.get(r.cuenta_padre_id) ?? [];
    arr.push(r.id);
    childrenByParent.set(r.cuenta_padre_id, arr);
  }
  const out = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop() as string;
    for (const child of childrenByParent.get(cur) ?? []) {
      if (!out.has(child)) {
        out.add(child);
        stack.push(child);
      }
    }
  }
  return out;
}

/**
 * Valida la relación de parentesco propuesta. `selfId` es null al crear.
 * Reglas: no auto-padre, no ciclos, el padre debe existir y tener nivel < hijo.
 */
export function validateParent(
  rows: PlanCuentaRow[],
  selfId: string | null,
  parentId: string | null,
  childNivel: number
): void {
  if (!parentId) return;
  if (selfId && parentId === selfId) {
    throw new PlanCuentaValidationError("Una cuenta no puede ser su propio padre.");
  }
  const parent = rows.find((r) => r.id === parentId);
  if (!parent) {
    throw new PlanCuentaValidationError("La cuenta padre seleccionada no existe.");
  }
  if (parent.nivel >= childNivel) {
    throw new PlanCuentaValidationError(
      `La cuenta padre (nivel ${parent.nivel}) debe tener un nivel menor que la hija (nivel ${childNivel}).`
    );
  }
  if (selfId) {
    const descendants = collectDescendants(rows, selfId);
    if (descendants.has(parentId)) {
      throw new PlanCuentaValidationError("No se puede asignar como padre a una cuenta descendiente (ciclo).");
    }
  }
}
