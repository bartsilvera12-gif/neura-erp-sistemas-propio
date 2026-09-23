/**
 * Servicios apagados a propósito: no son un problema aunque figuren caídos.
 *
 * ÚNICO lugar donde se define la lista. Para cambiarla hay dos caminos:
 *  - editar `SILENCIADOS` (y desplegar), o
 *  - definir `NEXT_PUBLIC_SERVICIOS_SILENCIADOS=uno,otro` en Coolify.
 *
 * Un servicio silenciado no pinta la tarjeta de rojo, no suma a "Incidentes
 * activos" y en el detalle aparece aparte, en "En pausa".
 */
const SILENCIADOS = ["supabase-pooler", "n8n"];

function lista(): string[] {
  const extra = (process.env.NEXT_PUBLIC_SERVICIOS_SILENCIADOS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [...SILENCIADOS.map((s) => s.toLowerCase()), ...extra];
}

/**
 * Coincide con el nombre exacto del contenedor o con los que le agregan un
 * sufijo (`n8n-abc123`), que es como los nombra Coolify.
 */
export function servicioSilenciado(name: string | null | undefined): boolean {
  const n = (name ?? "").trim().toLowerCase();
  if (!n) return false;
  return lista().some((s) => n === s || n.startsWith(`${s}-`));
}
