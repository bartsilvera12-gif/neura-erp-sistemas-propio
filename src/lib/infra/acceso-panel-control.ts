/**
 * Quién puede ver el módulo "Panel de Control" (estado de infraestructura).
 *
 * ÚNICO lugar donde se define la lista. Para sumar gente hay dos caminos y
 * ninguno obliga a tocar lógica:
 *  - agregar el correo a `PERMITIDOS` (y desplegar), o
 *  - definir `NEXT_PUBLIC_PANEL_CONTROL_EMAILS=uno@x.com,otro@y.com` en Coolify.
 *
 * Es `NEXT_PUBLIC_` a propósito: el sidebar es un componente de cliente y
 * necesita la misma lista para decidir si muestra el ítem. Eso NO es el
 * permiso — el permiso lo aplican la página y la API en el servidor, donde el
 * correo sale de la sesión de Supabase y no de nada que mande el navegador.
 */
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";

const PERMITIDOS = new Set(["alanayalapsn@gmail.com"]);

/**
 * Acceso final: los correos de la lista, los administradores del ERP
 * (`admin`, `administrador`, `super_admin`) y los desarrolladores
 * (`usuarios.es_tecnico`). El rol y la marca salen del catálogo `usuarios`, que
 * sólo se lee en el servidor; en el sidebar se pasan los que ya tiene cargados,
 * y si no los tiene, el ítem simplemente no se muestra.
 */
export function puedeEntrarAlPanelControl(
  email: string | null | undefined,
  rol: string | null | undefined,
  esTecnico?: boolean | null
): boolean {
  return puedeVerPanelControl(email) || esRolAdminEmpresaOGlobal(rol) || esTecnico === true;
}

/** Sólo la lista de correos habilitados a mano. */
export function puedeVerPanelControl(email: string | null | undefined): boolean {
  const e = email?.trim().toLowerCase();
  if (!e) return false;
  if (PERMITIDOS.has(e)) return true;
  const extra = (process.env.NEXT_PUBLIC_PANEL_CONTROL_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return extra.includes(e);
}
