import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import type { PreviewResponse, PreviewRow } from "@/lib/excel/import-types";
import type { Naturaleza } from "@/lib/plan-cuentas/plan-cuentas";

/** Encabezados admitidos (normalizados por normalizeHeader: upper, sin tildes, espacios->_). */
const H = {
  cuenta: "CUENTA",
  denominacion: "DENOMINACION",
  nivel: "NIVEL",
  naturaleza: "NATURALEZA",
  asentable: "ASENTABLE",
  centro_costo: "CENTRO_COSTO",
  moneda: "MONEDA",
  tipo_cambio: "TIPO_CAMBIO",
  cuenta_sset: "CUENTA_SSET",
} as const;

export interface ImportDraft {
  cuenta: string;
  denominacion: string;
  nivel: number | null;
  naturaleza: Naturaleza | null;
  asentable: boolean;
  centro_costo: boolean;
  moneda: string | null;
  tipo_cambio: string | null;
  cuenta_sset: string | null;
}

export interface ParsedImportRow {
  row_number: number;
  cuenta: string;
  draft: ImportDraft;
  errors: string[];
  warnings: string[];
}

function txtOrNull(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
}

function parseNaturaleza(v: string | undefined): Naturaleza | null {
  const s = (v ?? "").trim().toUpperCase();
  if (s === "D" || s === "DEUDORA") return "D";
  if (s === "A" || s === "ACREEDORA") return "A";
  return null;
}

function parseAsentable(v: string | undefined): boolean {
  const s = (v ?? "").trim().toUpperCase();
  return ["S", "SI", "SÍ", "TRUE", "1", "Y", "YES"].includes(s);
}

function parseCentroCosto(v: string | undefined): boolean {
  const s = (v ?? "").trim().toUpperCase();
  return ["SI", "SÍ", "S", "TRUE", "1", "Y", "YES"].includes(s);
}

/**
 * Resuelve la clave real de una columna admitiendo variantes de encabezado.
 * Necesario porque algunos parsers de CSV UTF-8 leen las tildes en cp1252
 * (p. ej. "Denominación" → "DENOMINACIN"); usamos coincidencia exacta y por prefijo.
 */
function buildKeyMap(keys: string[]): Record<keyof typeof H, string | null> {
  const find = (exact: string, prefix?: string): string | null => {
    if (keys.includes(exact)) return exact;
    if (prefix) {
      const k = keys.find((x) => x.startsWith(prefix));
      if (k) return k;
    }
    return null;
  };
  return {
    cuenta: find(H.cuenta),
    denominacion: find(H.denominacion, "DENOMINAC"),
    nivel: find(H.nivel),
    naturaleza: find(H.naturaleza, "NATURALEZ"),
    asentable: find(H.asentable),
    centro_costo: find(H.centro_costo, "CENTRO"),
    moneda: find(H.moneda),
    tipo_cambio: find(H.tipo_cambio, "TIPO"),
    cuenta_sset: find(H.cuenta_sset, "CUENTA_SS"),
  };
}

/** Parsea las filas crudas (Record<HEADER, string>) a drafts con validación por fila. */
export function parsePlanCuentaImportRows(rows: Record<string, string>[]): ParsedImportRow[] {
  const seenInFile = new Set<string>();
  const km = buildKeyMap(rows.length > 0 ? Object.keys(rows[0]) : []);
  const get = (r: Record<string, string>, k: keyof typeof H): string | undefined =>
    km[k] ? r[km[k] as string] : undefined;
  return rows.map((r, i) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const cuenta = (get(r, "cuenta") ?? "").trim();
    const denominacion = (get(r, "denominacion") ?? "").trim();
    const nivelRaw = (get(r, "nivel") ?? "").trim();
    const nivel = nivelRaw === "" ? null : Number(nivelRaw);
    const naturaleza = parseNaturaleza(get(r, "naturaleza"));

    if (!cuenta) errors.push("Falta el código de cuenta.");
    if (!denominacion) errors.push("Falta la denominación.");
    if (nivel === null || !Number.isInteger(nivel) || nivel < 1) errors.push("Nivel inválido (entero ≥ 1).");
    if (!naturaleza) errors.push("Naturaleza inválida (D o A).");
    if (cuenta) {
      if (seenInFile.has(cuenta)) errors.push(`Código duplicado dentro del archivo: "${cuenta}".`);
      else seenInFile.add(cuenta);
    }

    return {
      row_number: i + 2, // +1 header, +1 base-1
      cuenta,
      draft: {
        cuenta,
        denominacion,
        nivel,
        naturaleza,
        asentable: parseAsentable(get(r, "asentable")),
        centro_costo: parseCentroCosto(get(r, "centro_costo")),
        moneda: txtOrNull(get(r, "moneda")),
        tipo_cambio: txtOrNull(get(r, "tipo_cambio")),
        cuenta_sset: txtOrNull(get(r, "cuenta_sset")),
      },
      errors,
      warnings,
    };
  });
}

/** Construye la vista previa comparando contra los códigos ya existentes. */
export function buildPlanCuentasPreview(
  parsed: ParsedImportRow[],
  existingCodes: Set<string>,
  actualizarExistentes: boolean
): PreviewResponse {
  const rows: PreviewRow[] = parsed.map((p) => {
    let action: PreviewRow["action"];
    const errors = [...p.errors];
    if (errors.length > 0) {
      action = "ERROR";
    } else if (existingCodes.has(p.cuenta)) {
      action = actualizarExistentes ? "UPDATE" : "SKIP";
    } else {
      action = "INSERT";
    }
    return {
      row_number: p.row_number,
      action,
      warnings: p.warnings,
      errors,
      data: {
        cuenta: p.draft.cuenta,
        denominacion: p.draft.denominacion,
        nivel: p.draft.nivel,
        naturaleza: p.draft.naturaleza,
        asentable: p.draft.asentable,
        centro_costo: p.draft.centro_costo,
        moneda: p.draft.moneda,
        tipo_cambio: p.draft.tipo_cambio,
        cuenta_sset: p.draft.cuenta_sset,
      },
    };
  });

  const summary = {
    total: rows.length,
    insertar: rows.filter((r) => r.action === "INSERT").length,
    actualizar: rows.filter((r) => r.action === "UPDATE").length,
    omitir: rows.filter((r) => r.action === "SKIP").length,
    errores: rows.filter((r) => r.action === "ERROR").length,
    warnings: rows.reduce((a, r) => a + r.warnings.length, 0),
  };
  return { summary, rows, headers: Object.values(H) };
}

/** Resuelve el código padre por prefijo más largo existente dentro del universo de códigos. */
function resolveParentCode(code: string, allCodes: Set<string>): string | null {
  for (let len = code.length - 1; len >= 1; len--) {
    const pref = code.slice(0, len);
    if (allCodes.has(pref)) return pref;
  }
  return null;
}

export interface CommitOutcome {
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  warnings: number;
  errorMessages: string[];
  warningMessages: string[];
}

export async function commitPlanCuentasImport(
  supabase: AppSupabaseClient,
  empresaId: string,
  parsed: ParsedImportRow[],
  actualizarExistentes: boolean
): Promise<CommitOutcome> {
  // Estado actual: código -> id.
  const { data: existing, error: exErr } = await supabase
    .from("plan_cuentas")
    .select("id, cuenta")
    .eq("empresa_id", empresaId);
  if (exErr) throw new Error(exErr.message);
  const idByCode = new Map<string, string>((existing ?? []).map((r) => [(r as { cuenta: string }).cuenta, (r as { id: string }).id]));
  const existingCodes = new Set(idByCode.keys());

  const out: CommitOutcome = { inserted: 0, updated: 0, skipped: 0, errors: 0, warnings: 0, errorMessages: [], warningMessages: [] };

  const toInsert: ParsedImportRow[] = [];
  const toUpdate: ParsedImportRow[] = [];
  for (const p of parsed) {
    if (p.errors.length > 0) {
      out.errors++;
      out.errorMessages.push(`Fila ${p.row_number}: ${p.errors.join(" ")}`);
      continue;
    }
    if (existingCodes.has(p.cuenta)) {
      if (actualizarExistentes) toUpdate.push(p);
      else out.skipped++;
    } else {
      toInsert.push(p);
    }
  }

  // Insertar nuevos (sin padre todavía).
  for (const p of toInsert) {
    const { data, error } = await supabase
      .from("plan_cuentas")
      .insert({
        empresa_id: empresaId,
        cuenta: p.draft.cuenta,
        denominacion: p.draft.denominacion,
        nivel: p.draft.nivel,
        naturaleza: p.draft.naturaleza,
        asentable: p.draft.asentable,
        centro_costo: p.draft.centro_costo,
        moneda: p.draft.moneda,
        tipo_cambio: p.draft.tipo_cambio,
        cuenta_sset: p.draft.cuenta_sset,
      })
      .select("id, cuenta")
      .single();
    if (error) {
      out.errors++;
      out.errorMessages.push(`Fila ${p.row_number} (${p.cuenta}): ${error.message}`);
      continue;
    }
    out.inserted++;
    idByCode.set((data as { cuenta: string }).cuenta, (data as { id: string }).id);
  }

  // Actualizar existentes (solo con opción explícita).
  for (const p of toUpdate) {
    const { error } = await supabase
      .from("plan_cuentas")
      .update({
        denominacion: p.draft.denominacion,
        nivel: p.draft.nivel,
        naturaleza: p.draft.naturaleza,
        asentable: p.draft.asentable,
        centro_costo: p.draft.centro_costo,
        moneda: p.draft.moneda,
        tipo_cambio: p.draft.tipo_cambio,
        cuenta_sset: p.draft.cuenta_sset,
      })
      .eq("empresa_id", empresaId)
      .eq("cuenta", p.draft.cuenta);
    if (error) {
      out.errors++;
      out.errorMessages.push(`Fila ${p.row_number} (${p.cuenta}): ${error.message}`);
      continue;
    }
    out.updated++;
  }

  // Reenlazar padre de las cuentas insertadas por prefijo (no pisa padres ya definidos).
  const allCodes = new Set(idByCode.keys());
  for (const p of toInsert) {
    const parentCode = resolveParentCode(p.draft.cuenta, allCodes);
    if (!parentCode) continue;
    const parentId = idByCode.get(parentCode);
    const selfId = idByCode.get(p.draft.cuenta);
    if (!parentId || !selfId || parentId === selfId) continue;
    const { error } = await supabase
      .from("plan_cuentas")
      .update({ cuenta_padre_id: parentId })
      .eq("empresa_id", empresaId)
      .eq("id", selfId)
      .is("cuenta_padre_id", null);
    if (error) {
      out.warnings++;
      out.warningMessages.push(`No se pudo enlazar padre de ${p.cuenta}: ${error.message}`);
    }
  }

  return out;
}
