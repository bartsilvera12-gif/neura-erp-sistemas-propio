import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

/** Fila tal como vive en `neura.ayuda_categorias`. */
export interface AyudaCategoriaRow {
  id: string;
  empresa_id: string;
  nombre: string;
  slug: string;
  descripcion: string | null;
  orden: number;
  activo: boolean;
  /** Categoría madre. `null` = primer nivel. Un solo nivel de anidamiento. */
  parent_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Fila tal como vive en `neura.ayuda_articulos`. */
export interface AyudaArticuloRow {
  id: string;
  empresa_id: string;
  categoria_id: string | null;
  titulo: string;
  slug: string;
  resumen: string | null;
  contenido_md: string;
  modulo: string | null;
  roles_visibles: string[] | null;
  orden: number;
  publicado: boolean;
  vistas: number;
  creado_por: string | null;
  actualizado_por: string | null;
  created_at: string;
  updated_at: string;
}

/** Artículo enriquecido para la UI (nombre de categoría resuelto). */
export interface AyudaArticuloItem extends AyudaArticuloRow {
  categoria_nombre: string | null;
  categoria_slug: string | null;
}

/** Item de listado del lector: sin `contenido_md` para no inflar la respuesta. */
export type AyudaArticuloResumen = Omit<AyudaArticuloItem, "contenido_md">;

export interface AyudaSummary {
  total: number;
  publicados: number;
  borradores: number;
  categorias: number;
  sin_categoria: number;
}

export const ARTICULO_COLS =
  "id, empresa_id, categoria_id, titulo, slug, resumen, contenido_md, modulo, roles_visibles, orden, publicado, vistas, creado_por, actualizado_por, created_at, updated_at";

export const CATEGORIA_COLS =
  "id, empresa_id, nombre, slug, descripcion, orden, activo, parent_id, created_at, updated_at";

export class AyudaValidationError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Normaliza un rol de `usuarios.rol` para comparar contra `roles_visibles`. */
export function normalizeRolAyuda(rol: string | null | undefined): string {
  return (rol ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

/** Convierte un título en slug URL-safe (sin acentos ni signos). */
export function slugify(input: string): string {
  return (input ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Slug único dentro de la empresa: agrega `-2`, `-3`… si ya existe. */
export function uniqueSlug(base: string, taken: Set<string>, fallback = "articulo"): string {
  const root = slugify(base) || fallback;
  if (!taken.has(root)) return root;
  for (let i = 2; i < 500; i += 1) {
    const candidate = `${root}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${root}-${taken.size + 1}`;
}

function asTextOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function requireText(v: unknown, field: string): string {
  const s = v === null || v === undefined ? "" : String(v).trim();
  if (!s) throw new AyudaValidationError(`El campo "${field}" es obligatorio.`);
  return s;
}

function toBool(v: unknown, def = false): boolean {
  if (v === null || v === undefined) return def;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  return ["true", "1", "si", "sí", "s", "yes", "y"].includes(s);
}

function toInt(v: unknown, def = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function parseRoles(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out = new Set<string>();
  for (const r of v) {
    const n = normalizeRolAyuda(typeof r === "string" ? r : String(r ?? ""));
    if (n) out.add(n);
  }
  return Array.from(out).sort();
}

export interface AyudaArticuloCreate {
  titulo: string;
  slug: string | null;
  resumen: string | null;
  contenido_md: string;
  categoria_id: string | null;
  modulo: string | null;
  roles_visibles: string[];
  orden: number;
  publicado: boolean;
}

export function parseArticuloCreate(body: unknown): AyudaArticuloCreate {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    titulo: requireText(b.titulo, "Título"),
    slug: asTextOrNull(b.slug),
    resumen: asTextOrNull(b.resumen),
    contenido_md: typeof b.contenido_md === "string" ? b.contenido_md : "",
    categoria_id: asTextOrNull(b.categoria_id),
    modulo: asTextOrNull(b.modulo),
    roles_visibles: parseRoles(b.roles_visibles),
    orden: toInt(b.orden, 0),
    publicado: toBool(b.publicado, false),
  };
}

export type AyudaArticuloUpdate = Partial<AyudaArticuloCreate>;

export function parseArticuloUpdate(body: unknown): AyudaArticuloUpdate {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: AyudaArticuloUpdate = {};
  if ("titulo" in b) out.titulo = requireText(b.titulo, "Título");
  if ("slug" in b) out.slug = asTextOrNull(b.slug);
  if ("resumen" in b) out.resumen = asTextOrNull(b.resumen);
  if ("contenido_md" in b) out.contenido_md = typeof b.contenido_md === "string" ? b.contenido_md : "";
  if ("categoria_id" in b) out.categoria_id = asTextOrNull(b.categoria_id);
  if ("modulo" in b) out.modulo = asTextOrNull(b.modulo);
  if ("roles_visibles" in b) out.roles_visibles = parseRoles(b.roles_visibles);
  if ("orden" in b) out.orden = toInt(b.orden, 0);
  if ("publicado" in b) out.publicado = toBool(b.publicado, false);
  return out;
}

export interface AyudaCategoriaCreate {
  nombre: string;
  slug: string | null;
  descripcion: string | null;
  orden: number;
  activo: boolean;
}

export function parseCategoriaCreate(body: unknown): AyudaCategoriaCreate {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    nombre: requireText(b.nombre, "Nombre"),
    slug: asTextOrNull(b.slug),
    descripcion: asTextOrNull(b.descripcion),
    orden: toInt(b.orden, 0),
    activo: toBool(b.activo, true),
  };
}

// -----------------------------------------------------------------------------
// Lecturas
// -----------------------------------------------------------------------------

export async function listCategorias(
  supabase: AppSupabaseClient,
  empresaId: string
): Promise<AyudaCategoriaRow[]> {
  const { data, error } = await supabase
    .from("ayuda_categorias")
    .select(CATEGORIA_COLS)
    .eq("empresa_id", empresaId)
    .order("orden", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as AyudaCategoriaRow[];
  return rows.sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, "es"));
}

/**
 * Todos los artículos de la empresa, con la categoría resuelta.
 *
 * Trae `contenido_md` a propósito: el buscador del lector busca dentro del texto
 * y el conector Postgres del ERP no soporta `.or()`, así que un solo SELECT y el
 * filtrado en memoria sale más barato que tres queries y un merge de ids.
 */
export async function listArticulos(
  supabase: AppSupabaseClient,
  empresaId: string
): Promise<AyudaArticuloItem[]> {
  const [{ data, error }, categorias] = await Promise.all([
    supabase.from("ayuda_articulos").select(ARTICULO_COLS).eq("empresa_id", empresaId),
    listCategorias(supabase, empresaId),
  ]);
  if (error) throw new Error(error.message);

  const catById = new Map(categorias.map((c) => [c.id, c]));
  const rows = (data ?? []) as AyudaArticuloRow[];
  return rows
    .map((r) => {
      const cat = r.categoria_id ? catById.get(r.categoria_id) ?? null : null;
      return {
        ...r,
        roles_visibles: r.roles_visibles ?? [],
        categoria_nombre: cat?.nombre ?? null,
        categoria_slug: cat?.slug ?? null,
      };
    })
    .sort(
      (a, b) =>
        a.orden - b.orden ||
        (a.categoria_nombre ?? "").localeCompare(b.categoria_nombre ?? "", "es") ||
        a.titulo.localeCompare(b.titulo, "es")
    );
}

/** ¿Este usuario puede ver el artículo? Admin ve todo, incluidos los borradores. */
export function puedeVerArticulo(
  articulo: Pick<AyudaArticuloItem, "publicado" | "roles_visibles">,
  rol: string,
  esAdmin: boolean
): boolean {
  if (esAdmin) return true;
  if (!articulo.publicado) return false;
  const roles = articulo.roles_visibles ?? [];
  if (roles.length === 0) return true;
  return roles.includes(normalizeRolAyuda(rol));
}

/** Quita el cuerpo del artículo para los listados. */
export function stripContenido(a: AyudaArticuloItem): AyudaArticuloResumen {
  const { contenido_md: _contenido, ...rest } = a;
  void _contenido;
  return rest;
}

/** Coincidencia del buscador: título, resumen, categoría y cuerpo. */
export function matchesBusqueda(a: AyudaArticuloItem, queryRaw: string): boolean {
  const q = normalizeBusqueda(queryRaw);
  if (!q) return true;
  const haystack = normalizeBusqueda(
    [a.titulo, a.resumen ?? "", a.categoria_nombre ?? "", a.contenido_md].join(" \n ")
  );
  return q.split(/\s+/).every((token) => haystack.includes(token));
}

export function normalizeBusqueda(s: string): string {
  return (s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

export function summarize(articulos: AyudaArticuloItem[], categorias: AyudaCategoriaRow[]): AyudaSummary {
  return {
    total: articulos.length,
    publicados: articulos.filter((a) => a.publicado).length,
    borradores: articulos.filter((a) => !a.publicado).length,
    categorias: categorias.length,
    sin_categoria: articulos.filter((a) => !a.categoria_id).length,
  };
}
