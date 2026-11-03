/**
 * Tipos y helpers compartidos por las rutas de credenciales de proyecto y la UI.
 *
 * Nota de diseño: la contraseña viaja y se guarda en claro porque el caso de uso
 * es copiarla y pegarla en el panel externo. El control de acceso es el del
 * módulo (empresa_id + RLS + permiso de Proyectos), no el cifrado.
 */

export type ProyectoCredencial = {
  id: string;
  proyecto_id: string;
  nombre: string;
  url: string | null;
  usuario: string | null;
  password: string | null;
  /** Repositorio de GitHub asociado, en formato `owner/repo` (ej. `bartsilvera12-gif/neura-erp-mevo`). */
  repositorio: string | null;
  notas: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type ProyectoCredencialBody = {
  nombre?: string;
  url?: string | null;
  usuario?: string | null;
  password?: string | null;
  repositorio?: string | null;
  notas?: string | null;
};

/** Normaliza un campo opcional de texto: vacío o no-string -> null. */
export function textoOpcional(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t : null;
}

/**
 * Completa el esquema para que el link sea clickeable: los usuarios cargan
 * `panel.midominio.com` sin protocolo y `<a href>` lo tomaría como relativo.
 */
export function credencialHref(url: string | null | undefined): string | null {
  const raw = (url ?? "").trim();
  if (!raw) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw;
  if (raw.startsWith("//")) return `https:${raw}`;
  return `https://${raw}`;
}

/**
 * Link clickeable a GitHub para el repositorio guardado. Acepta tanto el formato
 * `owner/repo` (lo que guarda el selector) como una URL completa, por si alguien
 * pegó el link a mano. `null` si está vacío o no parece un repo válido.
 */
export function repoHref(repositorio: string | null | undefined): string | null {
  const raw = (repositorio ?? "").trim();
  if (!raw) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw;
  // owner/repo -> https://github.com/owner/repo
  if (/^[^/\s]+\/[^/\s]+$/.test(raw)) return `https://github.com/${raw}`;
  return null;
}
