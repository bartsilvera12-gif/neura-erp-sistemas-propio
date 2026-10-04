import { requireSoporteApi } from "@/lib/soporte/soporte-auth";
import { calcularSla, etiquetaTipo, type TicketFila } from "@/lib/soporte/dominio";
import { clientesDeEmpresa, errorInesperado, leerCatalogos, ok, personasPorId, sinPermiso } from "@/lib/soporte/servidor";
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
  if (!auth.veDashboard) return sinPermiso({ ok: false, status: 403, message: "El Dashboard de Soporte no está habilitado para tu usuario" });
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
        pendientes: cuenta("pendiente"),
        en_proceso: cuenta("en_proceso", "reabierto"),
        falta_informacion: cuenta("falta_informacion"),
        en_revision: cuenta("listo_revision"),
        resueltos: cuenta("resuelto"),
        cerrados: cuenta("cerrado", "cancelado"),
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

    // Tickets por TIPO DE SISTEMA: cada ticket es sobre un proyecto concreto, y
    // el proyecto tiene UN tipo (Web / SaaS-ERP / Mixto). Así se atribuye por
    // ticket —un cliente con 2 suscripciones reparte bien sus tickets—, sin
    // depender del "tipo de cliente" (ambiguo). Drift-safe: si el tenant no
    // tiene proyectos/tipos, queda vacío.
    let porSistema: { nombre: string; cantidad: number }[] = [];
    // Top clientes del período (por tickets) + el programador del proyecto de
    // esos tickets. Por ticket → proyecto → responsable_tecnico.
    let topClientes: { cliente: string; tickets: number; programador: string }[] = [];
    try {
      const [tiposRes, proysRes] = await Promise.all([
        auth.sb.from("proyecto_tipos").select("id, nombre").eq("empresa_id", auth.empresaId),
        auth.sb.from("proyectos").select("id, tipo_id, responsable_tecnico_id").eq("empresa_id", auth.empresaId).limit(5000),
      ]);
      const nombreTipo = new Map<string, string>();
      for (const tp of (tiposRes.data ?? []) as { id: string; nombre: string }[]) nombreTipo.set(tp.id, tp.nombre);
      const tipoDeProyecto = new Map<string, string | null>();
      const tecnicoDeProyecto = new Map<string, string | null>();
      for (const p of (proysRes.data ?? []) as { id: string; tipo_id: string | null; responsable_tecnico_id: string | null }[]) {
        tipoDeProyecto.set(p.id, p.tipo_id);
        tecnicoDeProyecto.set(p.id, p.responsable_tecnico_id);
      }

      // --- por tipo de sistema ---
      if (nombreTipo.size > 0) {
        const sistemas = new Map<string, number>();
        for (const t of actuales) {
          const tipoId = t.proyecto_id ? tipoDeProyecto.get(t.proyecto_id) ?? null : null;
          const nombre = (tipoId && nombreTipo.get(tipoId)) || "Sin sistema asociado";
          sistemas.set(nombre, (sistemas.get(nombre) ?? 0) + 1);
        }
        porSistema = [...sistemas.entries()].map(([nombre, cantidad]) => ({ nombre, cantidad })).sort((a, b) => b.cantidad - a.cantidad);
      }

      // --- top clientes + programador ---
      const porCliente = new Map<string, { tickets: number; tecnicos: Map<string, number> }>();
      for (const t of actuales) {
        const cid = t.cliente_id;
        if (!cid) continue;
        let agg = porCliente.get(cid);
        if (!agg) {
          agg = { tickets: 0, tecnicos: new Map() };
          porCliente.set(cid, agg);
        }
        agg.tickets += 1;
        const tecId = t.proyecto_id ? tecnicoDeProyecto.get(t.proyecto_id) ?? null : null;
        if (tecId) agg.tecnicos.set(tecId, (agg.tecnicos.get(tecId) ?? 0) + 1);
      }
      const top = [...porCliente.entries()].sort((a, b) => b[1].tickets - a[1].tickets).slice(0, 10);
      const clientes = await clientesDeEmpresa(auth.sb, auth.empresaId);
      const nombreCliente = new Map(clientes.map((c) => [c.id, c.nombre]));
      const tecnicoIds = top.flatMap(([, agg]) => [...agg.tecnicos.keys()]);
      const personas = await personasPorId(tecnicoIds);
      topClientes = top.map(([cid, agg]) => {
        // Programador principal = el del proyecto con más tickets de ese cliente;
        // si hay varios distintos, se indica "+N".
        const ordenados = [...agg.tecnicos.entries()].sort((a, b) => b[1] - a[1]);
        let programador = "Sin programador";
        if (ordenados.length > 0) {
          const principal = personas.get(ordenados[0][0])?.nombre ?? "—";
          programador = ordenados.length > 1 ? `${principal} +${ordenados.length - 1}` : principal;
        }
        return { cliente: nombreCliente.get(cid) ?? "Cliente", tickets: agg.tickets, programador };
      });
    } catch {
      porSistema = [];
      topClientes = [];
    }

    return ok({ dias, kpis: kActual, variacion, por_estado: porEstado, por_tipo: porTipo, por_sistema: porSistema, top_clientes: topClientes });
  } catch (e) {
    return errorInesperado(e);
  }
}
