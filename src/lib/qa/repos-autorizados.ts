/**
 * NEURA QA CENTER — catálogo de repositorios GitHub autorizados.
 *
 * Única fuente de verdad para el selector del formulario "Nuevo proyecto QA".
 * Pensado para que NO se pueda apuntar un proyecto QA a un repo que no esté
 * explícitamente autorizado por el equipo Neura.
 *
 * No se usa GitHub API ni se enumera indiscriminadamente. Si un repo no está
 * acá, el POST/PATCH de `projects` lo rechaza.
 *
 * Para agregar un repo nuevo, editar este archivo (no se puede autorizar por
 * panel: requiere cambio de código revisado).
 */

import type { CodebaseProyecto } from "./pruebas-catalogo";
import { REPO_URL_OVERRIDE } from "./pruebas-catalogo";

/** Entrada del catálogo: un repo autorizado con su codebase declarado. */
export type RepoAutorizado = {
  /** URL canónica https://github.com/<owner>/<name>. */
  url: string;
  /** Owner (org o usuario). */
  owner: string;
  /** Nombre del repo (sin owner). */
  name: string;
  /** Nombre visible, en español, para el selector. */
  etiqueta: string;
  /** Codebase lógico al que corresponde (define qué pruebas aplican). */
  codebase: CodebaseProyecto;
  /** Slug sugerido para el proyecto (kebab). El usuario puede cambiarlo. */
  slug_sugerido?: string;
  /** Rama por defecto. Si falta, "main". */
  default_branch?: string;
};

/**
 * Lista explícita de repos autorizados. Incluye los overrides ya declarados
 * en `pruebas-catalogo.ts` (no se duplican nombres: el override define el
 * mapeo slug→url, acá definimos url→metadata).
 *
 * NUEVOS repos se agregan abajo. Nada se descubre automáticamente: no se
 * consulta la GitHub API ni se pasa token.
 */
export const REPOS_AUTORIZADOS: ReadonlyArray<RepoAutorizado> = [
  // ──────────────────────────────────────────────────────────────────────
  // Codebase: sistemas-propio (el propio ERP Neura de gestión interna)
  // ──────────────────────────────────────────────────────────────────────
  {
    url: "https://github.com/bartsilvera12-gif/neura-erp-sistemas-propio",
    owner: "bartsilvera12-gif",
    name: "neura-erp-sistemas-propio",
    etiqueta: "Sistemas Propio (ERP Neura)",
    codebase: "sistemas-propio",
    slug_sugerido: "erp-neura",
    default_branch: "main",
  },
  // ──────────────────────────────────────────────────────────────────────
  // Codebase: erp-neura (ERPs multi-tenant de clientes)
  // ──────────────────────────────────────────────────────────────────────
  {
    url: "https://github.com/bartsilvera12-gif/neura-erp-roldan",
    owner: "bartsilvera12-gif",
    name: "neura-erp-roldan",
    etiqueta: "ERP Roldán e Hijos",
    codebase: "erp-neura",
    slug_sugerido: "erp-roldan-pendiente-entrega",
    default_branch: "main",
  },
];

/**
 * Normaliza una URL de GitHub para comparar:
 * - lowercase host
 * - sin trailing slash
 * - sin .git
 * - sólo path owner/name (sin query ni fragment)
 */
export function normalizarRepoUrl(input: string): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") return null;
  const parts = u.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  let name = parts[1];
  name = name.replace(/\.git$/i, "");
  if (!owner || !name) return null;
  return `https://github.com/${owner}/${name}`;
}

/** true si la URL está en la whitelist autorizada. */
export function esRepoAutorizado(repoUrl: string): boolean {
  const n = normalizarRepoUrl(repoUrl);
  if (!n) return false;
  const whitelist = new Set<string>(
    REPOS_AUTORIZADOS.map((r) => normalizarRepoUrl(r.url) ?? r.url.toLowerCase())
  );
  return whitelist.has(n);
}

/** Devuelve la lista de repos para exponer al cliente (sin secrets). */
export function listarReposAutorizados(): ReadonlyArray<RepoAutorizado> {
  // Suma los overrides declarados en pruebas-catalogo que NO están ya listados.
  const yaListados = new Set(
    REPOS_AUTORIZADOS.map((r) => normalizarRepoUrl(r.url))
  );
  const extras: RepoAutorizado[] = [];
  for (const [slug, url] of Object.entries(REPO_URL_OVERRIDE)) {
    const n = normalizarRepoUrl(url);
    if (!n || yaListados.has(n)) continue;
    const parts = n.replace("https://github.com/", "").split("/");
    extras.push({
      url: n,
      owner: parts[0] ?? "",
      name: parts[1] ?? "",
      etiqueta: `${parts[1] ?? n} (declarado por override)`,
      codebase: "otro",
      slug_sugerido: slug,
      default_branch: "main",
    });
  }
  return [...REPOS_AUTORIZADOS, ...extras];
}

/** Metadata de un repo a partir de su URL. null si no está autorizado. */
export function metadataDeRepo(repoUrl: string): RepoAutorizado | null {
  const n = normalizarRepoUrl(repoUrl);
  if (!n) return null;
  for (const r of listarReposAutorizados()) {
    if (normalizarRepoUrl(r.url) === n) return r;
  }
  return null;
}
