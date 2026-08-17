import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";

/**
 * GET /api/proyectos/panel — Panel GERENCIAL de proyectos.
 * Presupuesto = monto de la PRIMERA factura de VENTA (no suscripción, no anulada) del cliente
 * del proyecto, calculado al vuelo (no editable, no se guarda). Devuelve conteos y plata por
 * estado / asesor / tipo / rubro, entregados del mes (por historial de estados) y SLA por estado.
 */

const PAGE = 800;
const ANULADAS = new Set(["anulado", "corregida nc"]);

async function fetchAll(
  sb: Awaited<ReturnType<typeof getChatServiceClientForEmpresa>>,
  table: string,
  columns: string,
  empresaId: string
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from(table)
      .select(columns)
      .eq("empresa_id", empresaId)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const chunk = (data ?? []) as unknown as Record<string, unknown>[];
    out.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return out;
}

function ymEnAsuncion(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: "America/Asuncion" })
    .format(d)
    .slice(0, 7);
}

export async function GET(request: Request) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }
  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const empresaId = auth.empresaId;
    const catalog = createServiceRoleClient();

    const [proysRaw, estadosRaw, facturasRaw, histRaw] = await Promise.all([
      fetchAll(
        sb,
        "proyectos",
        "id, cliente_id, tipo_id, estado_id, responsable_comercial_id, brief_data, fecha_ingreso, fecha_prometida, archivado, created_at",
        empresaId
      ),
      fetchAll(sb, "proyecto_estados", "id, nombre, codigo, sort_order, es_estado_final, sla_horas_objetivo, cuenta_sla", empresaId),
      fetchAll(sb, "facturas", "cliente_id, fecha, monto, tipo, estado, suscripcion_id", empresaId),
      fetchAll(sb, "proyecto_estado_historial", "proyecto_id, estado_nuevo_id, entered_at, exited_at", empresaId),
    ]);

    // Solo proyectos vigentes (no archivados).
    const proys = proysRaw.filter((p) => !p.archivado);

    // Tipos.
    const tipoIds = [...new Set(proys.map((p) => String(p.tipo_id ?? "")).filter(Boolean))];
    const tipoNombre = new Map<string, string>();
    for (let i = 0; i < tipoIds.length; i += 120) {
      const slice = tipoIds.slice(i, i + 120);
      const { data } = await sb.from("proyecto_tipos").select("id, nombre").in("id", slice);
      for (const t of (data ?? []) as Record<string, unknown>[]) tipoNombre.set(String(t.id), String(t.nombre ?? ""));
    }

    // Vendedores (nombres).
    const comIds = [...new Set(proys.map((p) => String(p.responsable_comercial_id ?? "")).filter(Boolean))];
    const comNombre = new Map<string, string>();
    for (let i = 0; i < comIds.length; i += 120) {
      const slice = comIds.slice(i, i + 120);
      const { data } = await catalog.from("usuarios").select("id, nombre").eq("empresa_id", empresaId).in("id", slice);
      for (const u of (data ?? []) as Record<string, unknown>[]) comNombre.set(String(u.id), String(u.nombre ?? "").trim());
    }

    // Presupuesto por cliente = PRIMERA factura de VENTA (no suscripción, no anulada), por fecha asc.
    const facturas = [...facturasRaw].sort((a, b) =>
      String(a.fecha ?? "").localeCompare(String(b.fecha ?? ""))
    );
    const presupuestoPorCliente = new Map<string, number>();
    for (const f of facturas) {
      const cid = String(f.cliente_id ?? "");
      if (!cid || presupuestoPorCliente.has(cid)) continue;
      if (ANULADAS.has(String(f.estado ?? "").trim().toLowerCase())) continue;
      const esSus =
        String(f.tipo ?? "").trim().toLowerCase() === "suscripcion" ||
        (f.suscripcion_id != null && String(f.suscripcion_id).trim() !== "");
      if (esSus) continue;
      presupuestoPorCliente.set(cid, Number(f.monto) || 0);
    }
    const presupuestoDe = (p: Record<string, unknown>) =>
      presupuestoPorCliente.get(String(p.cliente_id ?? "")) ?? 0;

    // Estados: nombre, orden, final, sla objetivo.
    type EstMeta = { nombre: string; orden: number; final: boolean; cancel: boolean; slaHoras: number | null; cuentaSla: boolean };
    const estMeta = new Map<string, EstMeta>();
    for (const e of estadosRaw) {
      const nombre = String(e.nombre ?? "");
      const codigo = String(e.codigo ?? "");
      estMeta.set(String(e.id), {
        nombre,
        orden: Number(e.sort_order) || 99,
        final: e.es_estado_final === true,
        cancel: /cancel/i.test(nombre) || /cancel/i.test(codigo),
        slaHoras:
          typeof e.sla_horas_objetivo === "number" && Number.isFinite(e.sla_horas_objetivo)
            ? (e.sla_horas_objetivo as number)
            : null,
        cuentaSla: e.cuenta_sla !== false,
      });
    }
    // "Entregado" = estado final que NO es cancelación (para entregados/throughput).
    const entregadoEstadoIds = new Set(
      [...estMeta.entries()].filter(([, m]) => m.final && !m.cancel).map(([id]) => id)
    );

    // Historial: por proyecto, cuándo entró a su estado ACTUAL (para SLA/antigüedad); y entradas a
    // estado FINAL (para "entregados por mes").
    const entradaEstadoActual = new Map<string, number>(); // proyecto_id → ms
    const entradasFinal: { proyecto_id: string; ym: string }[] = [];
    const proyEstadoActual = new Map(proys.map((p) => [String(p.id), String(p.estado_id ?? "")]));
    for (const h of histRaw) {
      const pid = String(h.proyecto_id ?? "");
      const est = String(h.estado_nuevo_id ?? "");
      const enteredMs = h.entered_at ? Date.parse(String(h.entered_at)) : NaN;
      if (!pid || !Number.isFinite(enteredMs)) continue;
      // entró al estado actual (fila abierta o la más reciente de ese estado)
      if (est === proyEstadoActual.get(pid)) {
        const prev = entradaEstadoActual.get(pid);
        if (prev == null || enteredMs > prev) entradaEstadoActual.set(pid, enteredMs);
      }
      // entrada a estado "Entregado" (final no-cancelación) → entregado
      if (entregadoEstadoIds.has(est)) {
        entradasFinal.push({ proyecto_id: pid, ym: ymEnAsuncion(new Date(enteredMs)) });
      }
    }

    // ── Agregaciones ──
    const now = Date.now();
    const ymActual = ymEnAsuncion(new Date());

    // Por estado (cantidad + presupuesto) + SLA vencidos.
    const porEstadoMap = new Map<string, { cantidad: number; presupuesto: number; vencidos: number }>();
    for (const p of proys) {
      const eid = String(p.estado_id ?? "");
      const agg = porEstadoMap.get(eid) ?? { cantidad: 0, presupuesto: 0, vencidos: 0 };
      agg.cantidad += 1;
      agg.presupuesto += presupuestoDe(p);
      const meta = estMeta.get(eid);
      if (meta && meta.cuentaSla && meta.slaHoras != null && !meta.final) {
        const entered = entradaEstadoActual.get(String(p.id));
        if (entered != null && now - entered > meta.slaHoras * 3600 * 1000) agg.vencidos += 1;
      }
      porEstadoMap.set(eid, agg);
    }
    const por_estado = [...porEstadoMap.entries()]
      .sort((a, b) => (estMeta.get(a[0])?.orden ?? 99) - (estMeta.get(b[0])?.orden ?? 99))
      .map(([eid, v]) => ({
        estado: estMeta.get(eid)?.nombre ?? "(sin estado)",
        es_final: estMeta.get(eid)?.final ?? false,
        cantidad: v.cantidad,
        presupuesto: Math.round(v.presupuesto),
        sla_vencidos: v.vencidos,
        sla_configurado: estMeta.get(eid)?.slaHoras != null,
      }));

    // Por asesor.
    const porAseMap = new Map<string, { cantidad: number; presupuesto: number }>();
    for (const p of proys) {
      const k = String(p.responsable_comercial_id ?? "");
      const agg = porAseMap.get(k) ?? { cantidad: 0, presupuesto: 0 };
      agg.cantidad += 1;
      agg.presupuesto += presupuestoDe(p);
      porAseMap.set(k, agg);
    }
    const por_asesor = [...porAseMap.entries()]
      .map(([k, v]) => ({
        asesor: k ? comNombre.get(k) || k.slice(0, 8) : "Sin asignar",
        cantidad: v.cantidad,
        presupuesto: Math.round(v.presupuesto),
      }))
      .sort((a, b) => b.presupuesto - a.presupuesto || b.cantidad - a.cantidad);

    // Por tipo.
    const porTipoMap = new Map<string, { cantidad: number; presupuesto: number }>();
    for (const p of proys) {
      const k = String(p.tipo_id ?? "");
      const agg = porTipoMap.get(k) ?? { cantidad: 0, presupuesto: 0 };
      agg.cantidad += 1;
      agg.presupuesto += presupuestoDe(p);
      porTipoMap.set(k, agg);
    }
    const por_tipo = [...porTipoMap.entries()]
      .map(([k, v]) => ({ tipo: tipoNombre.get(k) || "(sin tipo)", cantidad: v.cantidad, presupuesto: Math.round(v.presupuesto) }))
      .sort((a, b) => b.cantidad - a.cantidad);

    // Por rubro (brief_data.tipo_web).
    const porRubroMap = new Map<string, number>();
    for (const p of proys) {
      const bd = p.brief_data && typeof p.brief_data === "object" && !Array.isArray(p.brief_data)
        ? (p.brief_data as Record<string, unknown>)
        : {};
      const rubro = String(bd.tipo_web ?? "").trim() || "Sin rubro";
      porRubroMap.set(rubro, (porRubroMap.get(rubro) ?? 0) + 1);
    }
    const por_rubro = [...porRubroMap.entries()]
      .map(([rubro, cantidad]) => ({ rubro, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad);

    // Entregados este mes + últimos 6 meses (por primera entrada a estado final, distinct proyecto/mes).
    const entregadoMesProy = new Map<string, Set<string>>(); // ym → set proyecto_id
    for (const e of entradasFinal) {
      if (!entregadoMesProy.has(e.ym)) entregadoMesProy.set(e.ym, new Set());
      entregadoMesProy.get(e.ym)!.add(e.proyecto_id);
    }
    const proyById = new Map(proys.map((p) => [String(p.id), p]));
    const meses6: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      meses6.push(ymEnAsuncion(d));
    }
    const entregados_por_mes = meses6.map((ym) => {
      const set = entregadoMesProy.get(ym) ?? new Set<string>();
      let monto = 0;
      for (const pid of set) {
        const p = proyById.get(pid);
        if (p) monto += presupuestoDe(p);
      }
      return { ym, cantidad: set.size, monto: Math.round(monto) };
    });
    const entregadosMesSet = entregadoMesProy.get(ymActual) ?? new Set<string>();
    let entregados_mes_monto = 0;
    for (const pid of entregadosMesSet) {
      const p = proyById.get(pid);
      if (p) entregados_mes_monto += presupuestoDe(p);
    }

    // KPIs globales.
    const presupuestoTotal = proys.reduce((a, p) => a + presupuestoDe(p), 0);
    const conPresupuesto = proys.filter((p) => presupuestoDe(p) > 0).length;
    const activosNoFinal = proys.filter((p) => !(estMeta.get(String(p.estado_id ?? ""))?.final)).length;
    const vencidosTotal = por_estado.reduce((a, e) => a + e.sla_vencidos, 0);

    return NextResponse.json(
      successResponse({
        kpis: {
          total: proys.length,
          en_curso: activosNoFinal,
          entregados_mes: entregadosMesSet.size,
          entregados_mes_monto: Math.round(entregados_mes_monto),
          presupuesto_total: Math.round(presupuestoTotal),
          con_presupuesto: conPresupuesto,
          ticket_promedio: conPresupuesto > 0 ? Math.round(presupuestoTotal / conPresupuesto) : 0,
          sla_vencidos: vencidosTotal,
        },
        por_estado,
        por_asesor,
        por_tipo,
        por_rubro,
        entregados_por_mes,
        periodo_ym: ymActual,
      })
    );
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error"), { status: 500 });
  }
}
