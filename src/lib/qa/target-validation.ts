/**
 * NEURA QA CENTER — validación de `target_base_url` para proyectos/runs.
 *
 * No permite destinos productivos: rechaza cualquier URL cuyo host esté en
 * `PROD_SUPABASE_HOSTS` (fuente de verdad ya existente) o en la lista de
 * hosts productivos del ERP. Reusa la constante ya exportada por
 * `@/lib/qa/env-assert` para no duplicar.
 */

import { PROD_SUPABASE_HOSTS } from "@/lib/qa/env-assert";

/** Hosts del ERP productivo. Todo lo que sea otro dominio queda a la allow-list del runner. */
const PROD_ERP_HOSTS: ReadonlyArray<string> = [
  "sistemas.neura.com.py",
  "sistemas-new.neura.com.py",
  "www.sistemas-new.neura.com.py",
];

export type TargetValidation =
  | { ok: true; host: string; target_env: "staging" | "preview" | "local" }
  | { ok: false; reason: string };

export function validateTargetBaseUrl(
  input: string,
  target_env: "staging" | "preview" | "local"
): TargetValidation {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return { ok: false, reason: "target_base_url vacío" };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: "target_base_url no es una URL válida" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `protocolo no permitido: ${url.protocol}` };
  }
  const host = url.hostname.toLowerCase();
  if (PROD_SUPABASE_HOSTS.includes(host)) {
    return { ok: false, reason: `host ${host} está en PROD_SUPABASE_HOSTS` };
  }
  if (PROD_ERP_HOSTS.includes(host)) {
    return { ok: false, reason: `host ${host} corresponde al ERP productivo` };
  }
  return { ok: true, host, target_env };
}

/** Valida una lista de specs: no vacía, sólo `*.spec.ts`, sin paths. */
export function validateSpecs(specs: unknown): { ok: true; specs: string[] } | { ok: false; reason: string } {
  if (!Array.isArray(specs) || specs.length === 0) {
    return { ok: false, reason: "specs debe ser un array no vacío" };
  }
  const bad: string[] = [];
  const clean: string[] = [];
  for (const s of specs) {
    if (typeof s !== "string") {
      bad.push(String(s));
      continue;
    }
    const t = s.trim();
    // Sin separadores de path ni rutas relativas; sólo nombre de archivo spec.
    if (!/^[A-Za-z0-9_\-.]+\.spec\.ts$/.test(t)) {
      bad.push(t);
      continue;
    }
    clean.push(t);
  }
  if (bad.length > 0) {
    return { ok: false, reason: `specs inválidos: ${bad.slice(0, 5).join(", ")}` };
  }
  // Normaliza duplicados preservando orden.
  const seen = new Set<string>();
  const unique = clean.filter((s) => (seen.has(s) ? false : (seen.add(s), true)));
  return { ok: true, specs: unique };
}

/** Normaliza/valida un slug: kebab, 2-40 chars, alfanum + '-'. */
export function validateSlug(input: unknown): { ok: true; slug: string } | { ok: false; reason: string } {
  if (typeof input !== "string") return { ok: false, reason: "slug requerido" };
  const s = input.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(s)) {
    return { ok: false, reason: "slug debe ser kebab-case 2-40 chars" };
  }
  return { ok: true, slug: s };
}
