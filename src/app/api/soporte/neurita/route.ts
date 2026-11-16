import { requireSoporteApi } from "@/lib/soporte/soporte-auth";
import { errorInesperado, ok, sinPermiso } from "@/lib/soporte/servidor";
import { datosNeurita } from "@/lib/soporte/neurita-datos";

/**
 * GET /api/soporte/neurita — tablero del agente de IA.
 *
 * El cálculo vive en `neurita-datos.ts` porque el PDF descargable usa el mismo:
 * lo que se ve en pantalla y lo que se descarga nunca pueden diferir.
 */
export async function GET(request: Request) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  try {
    return ok(await datosNeurita(auth));
  } catch (e) {
    return errorInesperado(e);
  }
}
