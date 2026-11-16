import { requireSoporteApi } from "@/lib/soporte/soporte-auth";
import { errorInesperado, ok, sinPermiso } from "@/lib/soporte/servidor";
import { datosNeurita } from "@/lib/soporte/neurita-datos";

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Lee `desde`/`hasta` de la URL. Fechas inválidas se ignoran, no rompen. */
function rangoDe(request: Request) {
  const sp = new URL(request.url).searchParams;
  const leer = (k: string) => {
    const v = sp.get(k) ?? "";
    return RE_FECHA.test(v) ? v : null;
  };
  let desde = leer("desde");
  let hasta = leer("hasta");
  // Rango al revés: se da vuelta en vez de devolver vacío.
  if (desde && hasta && hasta < desde) [desde, hasta] = [hasta, desde];
  return { desde, hasta };
}

/**
 * GET /api/soporte/neurita?desde=YYYY-MM-DD&hasta=YYYY-MM-DD — tablero del agente.
 *
 * El cálculo vive en `neurita-datos.ts` porque el PDF descargable usa el mismo:
 * lo que se ve en pantalla y lo que se descarga nunca pueden diferir.
 */
export async function GET(request: Request) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  try {
    return ok(await datosNeurita(auth, rangoDe(request)));
  } catch (e) {
    return errorInesperado(e);
  }
}
