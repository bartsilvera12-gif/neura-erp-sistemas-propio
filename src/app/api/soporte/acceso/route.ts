import { requireSoporteApi } from "@/lib/soporte/soporte-auth";
import { ok, sinPermiso } from "@/lib/soporte/servidor";

/**
 * GET /api/soporte/acceso — qué partes de Soporte ve quien consulta.
 * Lo usan el menú lateral y el Dashboard para ocultar/redirigir; cada API
 * vuelve a comprobar su permiso por su cuenta.
 */
export async function GET(request: Request) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  return ok({ dashboard: auth.veDashboard, configuracion: auth.puedeConfigurar });
}
