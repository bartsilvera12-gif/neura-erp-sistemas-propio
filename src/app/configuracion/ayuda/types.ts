/** Tipos del cliente para la Ayuda en línea (espejo de `@/lib/ayuda/ayuda`, que es server-only). */

export interface AyudaCategoria {
  id: string;
  nombre: string;
  slug: string;
  descripcion: string | null;
  orden: number;
  activo: boolean;
}

export interface AyudaArticulo {
  id: string;
  categoria_id: string | null;
  categoria_nombre: string | null;
  categoria_slug: string | null;
  titulo: string;
  slug: string;
  resumen: string | null;
  contenido_md: string;
  modulo: string | null;
  roles_visibles: string[];
  orden: number;
  publicado: boolean;
  vistas: number;
  created_at: string;
  updated_at: string;
}

/** Item de listado del lector: igual pero sin el cuerpo. */
export type AyudaArticuloResumen = Omit<AyudaArticulo, "contenido_md">;

export interface AyudaSummary {
  total: number;
  publicados: number;
  borradores: number;
  categorias: number;
  sin_categoria: number;
}

export interface AyudaAdminResponse {
  articulos: AyudaArticulo[];
  categorias: AyudaCategoria[];
  feedback: Record<string, { util: number; no_util: number }>;
  summary: AyudaSummary;
  meta: { can_edit: boolean; roles_disponibles: string[] };
}

export interface AyudaVersion {
  id: string;
  titulo: string;
  contenido_md: string;
  created_at: string;
}

/**
 * Módulos del ERP a los que se puede atar un artículo. Habilita la ayuda
 * contextual: desde Cobranzas se ofrecen los artículos de Cobranzas.
 */
export const MODULOS_AYUDA: { value: string; label: string }[] = [
  { value: "", label: "— Sin módulo específico —" },
  { value: "clientes", label: "Clientes" },
  { value: "crm", label: "CRM Funnel" },
  { value: "ventas", label: "Caja / Ventas" },
  { value: "facturas", label: "Facturas" },
  { value: "cobranzas", label: "Cobranzas" },
  { value: "pagos", label: "Pagos" },
  { value: "comisiones", label: "Comisiones" },
  { value: "compras", label: "Compras" },
  { value: "gastos", label: "Gastos" },
  { value: "inventario", label: "Inventario" },
  { value: "planes", label: "Planes" },
  { value: "proyectos", label: "Proyectos" },
  { value: "conversaciones", label: "Conversaciones" },
  { value: "campanas", label: "Campañas" },
  { value: "marketing", label: "Marketing" },
  { value: "reportes", label: "Reportes" },
];

/** Etiqueta legible para un rol normalizado (`asesor_comercial` → `Asesor comercial`). */
export function rolLabel(rol: string): string {
  const limpio = rol.replace(/_/g, " ").trim();
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

export interface AyudaAdjunto {
  id: string;
  nombre: string;
  mime_type: string | null;
  size_bytes: number | null;
  orden: number;
  created_at: string;
}

/** Tamaño legible: 1.2 MB, 340 KB… */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  const u = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
}
