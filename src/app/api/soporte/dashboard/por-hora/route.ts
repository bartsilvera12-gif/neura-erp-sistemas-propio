import { requireSoporteApi } from "@/lib/soporte/soporte-auth";
import { ticketsParaAgregar } from "@/lib/soporte/agregados-servidor";
import { ok, sinPermiso, errorInesperado } from "@/lib/soporte/servidor";
import { TZ_PY } from "@/lib/format/hora-py";

export const runtime = "nodejs";

/**
 * GET /api/soporte/dashboard/por-hora?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 *
 * Distribución de tickets CARGADOS por hora del día (0–23), en hora de Paraguay
 * (`created_at` es timestamptz UTC). Rango de fechas propio de la card del
 * dashboard de Soporte. Reutiliza `ticketsParaAgregar` (misma consulta paginada
 * que el resto del dashboard) filtrando por `created_at` en el servidor.
 */
export async function GET(request: Request) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  try {
    const params = new URL(request.url).searchParams;
    const desde = params.get("desde") || "";
    const hasta = params.get("hasta") || "";

    const tickets = await ticketsParaAgregar(auth.sb, auth.empresaId, (q) => {
      let qq = q;
      if (desde) qq = qq.gte("created_at", desde);
      // Fin de día inclusive.
      if (hasta) qq = qq.lte("created_at", `${hasta}T23:59:59.999`);
      return qq;
    });

    // Agrupar por hora en hora de Paraguay (offset fijo UTC-3, ver hora-py).
    const horas = Array.from({ length: 24 }, (_, h) => ({ hora: h, total: 0 }));
    const fmtHora = new Intl.DateTimeFormat("en-US", { timeZone: TZ_PY, hour: "2-digit", hour12: false });
    for (const t of tickets) {
      const raw = (t as { created_at?: string | null }).created_at;
      if (!raw) continue;
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) continue;
      let h = parseInt(fmtHora.format(d), 10);
      if (h === 24) h = 0;
      if (h >= 0 && h <= 23) horas[h].total += 1;
    }

    const total = horas.reduce((s, h) => s + h.total, 0);
    return ok({ desde: desde || null, hasta: hasta || null, total, horas });
  } catch (e) {
    return errorInesperado(e);
  }
}
