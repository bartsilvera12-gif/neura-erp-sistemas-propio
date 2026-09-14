import { requireSoporteApi } from "@/lib/soporte/soporte-auth";
import { calcularSla, etiquetaTipo, type TicketFila } from "@/lib/soporte/dominio";
import { errorInesperado, leerCatalogos, ok, sinPermiso } from "@/lib/soporte/servidor";
import { ticketsParaAgregar } from "@/lib/soporte/agregados-servidor";

const DIA_MS = 86_400_000;

/**
 * GET /api/soporte/dashboard?dias=30
 *
 * Vista ejecutiva: KPIs de los tickets creados en el período, con la variación
 * contra el período anterior de igual largo, y las dos distribuciones del
 * tablero. `dias=0` = todo el historial (sin comparación).
 */
export async function GET(request: Request) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  try {
    const dias = Math.max(0, Math.min(365, Number(new URL(request.url).searchParams.get("dias") ?? "30") || 0));
    const cat = await leerCatalogos(auth.sb, auth.empresaId);
    const todos = await ticketsParaAgregar(auth.sb, auth.empresaId);

    const ahora = Date.now();
    const ahoraIso = new Date(ahora).toISOString();
    const inicio = dias ? ahora - dias * DIA_MS : null;
    const inicioPrevio = dias ? ahora - 2 * dias * DIA_MS : null;

    const enRango = (t: TicketFila, desde: number | null, hasta: number) => {
      const c = Date.parse(t.created_at);
      return (desde == null || c >= desde) && c < hasta;
    };
    const actuales = todos.filter((t) => enRango(t, inicio, ahora + 1));
    const previos = inicio != null ? todos.filter((t) => enRango(t, inicioPrevio, inicio)) : [];

    const kpis = (lista: TicketFila[]) => {
      const cuenta = (...codigos: string[]) => lista.filter((t) => codigos.includes(t.estado_codigo)).length;
      return {
        total: lista.length,
        abiertos: cuenta("registrado", "clasificado"),
        en_desarrollo: cuenta("en_desarrollo"),
        en_qa: cuenta("en_qa"),
        con_observaciones: cuenta("con_observaciones"),
        resueltos: cuenta("resuelto"),
        cerrados: cuenta("cerrado"),
        sla_vencidos: lista.filter((t) => calcularSla(t, ahoraIso).estado === "vencido").length,
      };
    };
    const kActual = kpis(actuales);
    const kPrevio = inicio != null ? kpis(previos) : null;
    const variacion: Record<string, number | null> = {};
    for (const k of Object.keys(kActual) as (keyof typeof kActual)[]) {
      const antes = kPrevio?.[k];
      variacion[k] = antes == null || antes === 0 ? null : Math.round(((kActual[k] - antes) / antes) * 100);
    }

    const porEstado = cat.estados
      .filter((e) => e.activo)
      .map((e) => ({
        codigo: e.codigo,
        nombre: e.nombre,
        color: e.color,
        cantidad: actuales.filter((t) => t.estado_codigo === e.codigo).length,
      }));

    const tipos = new Map<string, number>();
    for (const t of actuales) {
      const et = etiquetaTipo(cat, t.tipo_codigo, t.clasificacion_codigo);
      tipos.set(et, (tipos.get(et) ?? 0) + 1);
    }
    const porTipo = [...tipos.entries()].map(([nombre, cantidad]) => ({ nombre, cantidad })).sort((a, b) => b.cantidad - a.cantidad);

    return ok({ dias, kpis: kActual, variacion, por_estado: porEstado, por_tipo: porTipo });
  } catch (e) {
    return errorInesperado(e);
  }
}
