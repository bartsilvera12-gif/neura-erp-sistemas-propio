/** Categorías de productos: tipos y helpers compartidos (cliente y servidor). */
export type Categoria = {
  id: string;
  nombre: string;
  codigo: string | null;
  descripcion: string | null;
  parent_id: string | null;
  activo: boolean;
  /** color elegido (#rrggbb) — solo categorías principales; null = automático */
  color?: string | null;
  /** receta 70: estación de cocina (null = la de su categoría madre, o Cocina general) */
  estacion_id?: string | null;
  created_at?: string;
};

export const COLS_CATEGORIA = "id, nombre, codigo, descripcion, parent_id, activo, color, estacion_id, created_at, updated_at";

/** Código a partir del nombre: minúsculas, sin acentos, _ como separador (máx. 60). */
export function slugCodigo(nombre: string): string {
  const s = nombre.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  return s || "categoria";
}

/**
 * Color consistente por categoría (hash del nombre): cada categoría queda con el suyo
 * y el ojo agrupa rápido la columna. Paleta de Ferretería.
 */
export const PALETA = [
  { dot: "#ef4444", bg: "#fef2f2" }, { dot: "#f97316", bg: "#fff7ed" }, { dot: "#eab308", bg: "#fefce8" },
  { dot: "#22c55e", bg: "#f0fdf4" }, { dot: "#14b8a6", bg: "#f0fdfa" }, { dot: "#3b82f6", bg: "#eff6ff" },
  { dot: "#8b5cf6", bg: "#f5f3ff" }, { dot: "#ec4899", bg: "#fdf2f8" }, { dot: "#0ea5e9", bg: "#f0f9ff" },
  { dot: "#84cc16", bg: "#f7fee7" }, { dot: "#6366f1", bg: "#eef2ff" }, { dot: "#f59e0b", bg: "#fffbeb" },
];
export function colorCategoria(nombre: string) {
  let h = 0;
  for (let i = 0; i < nombre.length; i++) h = (h * 31 + nombre.charCodeAt(i)) >>> 0;
  return PALETA[h % PALETA.length];
}

/**
 * Subcategorías: el producto apunta a la hoja (subcategoría si tiene, si no la categoría).
 * Devuelve la categoría madre y la subcategoría de un id.
 */
export function partesCategoria(id: string | null | undefined, porId: Map<string, Categoria>) {
  const c = id ? porId.get(id) : undefined;
  if (!c) return { madre: undefined, sub: undefined };
  const madre = c.parent_id ? porId.get(c.parent_id) : undefined;
  return madre ? { madre, sub: c } : { madre: c, sub: undefined };
}

/** "Bebidas › Gaseosas" (o solo "Bebidas" si no tiene subcategoría). */
export function rutaCategoria(id: string | null | undefined, porId: Map<string, Categoria>) {
  const { madre, sub } = partesCategoria(id, porId);
  if (!madre) return undefined;
  return sub ? `${madre.nombre} › ${sub.nombre}` : madre.nombre;
}

/** Opciones de filtro: cada categoría seguida de sus subcategorías ("Bebidas › Gaseosas").
 *  Filtrar por la categoría incluye también a sus subcategorías. */
export function opcionesFiltroCategoria(categorias: Categoria[]): [string, string][] {
  const orden = [...categorias].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  return orden.filter((c) => !c.parent_id).flatMap((m): [string, string][] => [
    [m.id, m.nombre],
    ...orden.filter((c) => c.parent_id === m.id).map((c): [string, string] => [c.id, `${m.nombre} › ${c.nombre}`]),
  ]);
}

export type ColorCategoria = { dot: string; bg: string };

/** Color de un hex elegido: si es de la paleta usa su fondo; si no, el mismo color suave. */
export function colorDeHex(hex: string): ColorCategoria {
  return PALETA.find((p) => p.dot.toLowerCase() === hex.toLowerCase()) ?? { dot: hex, bg: `${hex}1f` };
}

/**
 * Color de cada categoría: el que eligió el usuario, y si no eligió, uno DISTINTO de los
 * que quedan libres (en orden de creación, así crear una nueva no le cambia el color a las
 * demás). Las subcategorías usan el color de su categoría.
 */
export function coloresPorCategoria(categorias: Categoria[]) {
  const raices = categorias
    .filter((c) => !c.parent_id)
    .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.nombre.localeCompare(b.nombre, "es"));
  const mapa = new Map<string, ColorCategoria>();
  const usados = new Set(raices.filter((c) => c.color).map((c) => c.color!.toLowerCase()));
  const libres = PALETA.filter((p) => !usados.has(p.dot.toLowerCase()));
  let i = 0;
  for (const c of raices) {
    if (c.color) mapa.set(c.id, colorDeHex(c.color));
    else mapa.set(c.id, libres.length ? libres[i++ % libres.length] : PALETA[i++ % PALETA.length]);
  }
  for (const c of categorias) if (c.parent_id && mapa.has(c.parent_id)) mapa.set(c.id, mapa.get(c.parent_id)!);
  return mapa;
}

/** Primer color que ninguna categoría está mostrando (para proponerlo al crear una nueva). */
export function colorLibre(categorias: Categoria[]): string {
  const enUso = new Set([...coloresPorCategoria(categorias).values()].map((c) => c.dot.toLowerCase()));
  return (PALETA.find((p) => !enUso.has(p.dot.toLowerCase())) ?? PALETA[0]).dot;
}

/** Tonos para pintar una etiqueta con el color de su categoría (cualquier hex):
 *  fondo suave, borde y un texto bien oscuro del mismo color para que siempre se lea. */
export function tonosDe(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const k = lum > 0.6 ? 0.38 : 0.55;
  const osc = (v: number) => Math.round(v * k).toString(16).padStart(2, "0");
  return { dot: hex, fondo: `${hex}1a`, borde: `${hex}55`, texto: `#${osc(r)}${osc(g)}${osc(b)}` };
}
