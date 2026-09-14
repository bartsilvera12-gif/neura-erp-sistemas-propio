import { requireSoporteApi } from "@/lib/soporte/soporte-auth";
import { calcularSla } from "@/lib/soporte/dominio";
import { clientesPorId, errorInesperado, leerCatalogos, ok, sinPermiso } from "@/lib/soporte/servidor";
import { ticketsParaAgregar } from "@/lib/soporte/agregados-servidor";

/**
 * GET /api/soporte/clientes
 *
 * Vista de soporte SOBRE los clientes existentes: sólo los que tienen tickets,
 * con sus números. No hay tabla nueva de clientes; se agrega desde los tickets
 * y el nombre sale de Clientes.
 */
export async function GET(request: Request) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  try {
    const cat = await leerCatalogos(auth.sb, auth.empresaId);
    const tickets = await ticketsParaAgregar(auth.sb, auth.empresaId, (q) => q.not("cliente_id", "is", null));
    const ahora = new Date().toISOString();
    const cerrados = new Set(cat.estados.filter((e) => e.tipo === "cerrado").map((e) => e.codigo));

    type Fila = {
      cliente_id: string;
      abiertos: number;
      cerrados: number;
      urgentes: number;
      sla_vencidos: number;
      ultimo: { id: string; numero: number; asunto: string; created_at: string } | null;
      ultima_actividad: string | null;
    };
    const mapa = new Map<string, Fila>();
    for (const t of tickets) {
      const id = t.cliente_id as string;
      const f = mapa.get(id) ?? { cliente_id: id, abiertos: 0, cerrados: 0, urgentes: 0, sla_vencidos: 0, ultimo: null, ultima_actividad: null };
      const cerrado = cerrados.has(t.estado_codigo);
      if (cerrado) f.cerrados += 1;
      else {
        f.abiertos += 1;
        if (t.prioridad_codigo === "urgente") f.urgentes += 1;
        if (calcularSla(t, ahora).estado === "vencido") f.sla_vencidos += 1;
      }
      if (!f.ultimo || t.created_at > f.ultimo.created_at) {
        f.ultimo = { id: t.id, numero: t.numero, asunto: t.asunto, created_at: t.created_at };
      }
      if (!f.ultima_actividad || t.updated_at > f.ultima_actividad) f.ultima_actividad = t.updated_at;
      mapa.set(id, f);
    }

    const nombres = await clientesPorId(auth.sb, auth.empresaId, [...mapa.keys()]);
    const filas = [...mapa.values()]
      .map((f) => ({ ...f, cliente_nombre: nombres.get(f.cliente_id) ?? "Cliente" }))
      .sort((a, b) => b.abiertos - a.abiertos || (b.ultima_actividad ?? "").localeCompare(a.ultima_actividad ?? ""));
    return ok(filas);
  } catch (e) {
    return errorInesperado(e);
  }
}
