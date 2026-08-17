import "server-only";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { PROYECTO_ETAPAS, etapaLabel } from "@/lib/proyectos/etapas-desarrollo";
import {
  esCancelacion,
  esEstadoEntrega,
  esResponsabilidadArea,
  umbralEstancadoSegundos,
} from "@/lib/produccion/umbrales";

/**
 * Reporte Gerencial de Producción / Programación (read-only). Cruza el eje comercial
 * (`proyecto_estados`) con el eje técnico (`etapa_desarrollo`), derivando todo
 * retroactivamente del event log `proyecto_estado_historial`. Scoped por empresa.
 *
 * Notas de arquitectura (ver plan):
 *  - Las tablas `proyecto_*`/`clientes` viven en el schema del TENANT (replicadas por empresa),
 *    NO en el schema fijo de catálogo. El schema se resuelve por empresa y se interpola con
 *    `quoteSchemaTable()` (valida contra whitelist/denylist). El resto va parametrizado ($1,$2…).
 *  - `usuarios` vive en el catálogo → no se joinea en SQL; se hidrata aparte con service role.
 *  - node-pg devuelve `numeric` como string → todo pasa por `num()`.
 */

const num = (v: unknown): number => (v == null ? 0 : Number(v));

function periodToDate(period?: string): string {
  if (period && /^\d{4}-\d{2}$/.test(period)) return `${period}-01`;
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function varPct(a: number, b: number): number | null {
  return b === 0 ? null : Math.round(((a - b) / b) * 1000) / 10;
}

function median(xs: number[]): number | null {
  const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/** Percentil p (0-100) con interpolación lineal. */
function percentile(xs: number[], p: number): number | null {
  const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  if (a.length === 1) return a[0];
  const idx = (p / 100) * (a.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return a[lo];
  return a[lo] + (a[hi] - a[lo]) * (idx - lo);
}

const DAY_MS = 86_400_000;
function diffDias(fromMs: number, toMs: number): number {
  return (toMs - fromMs) / DAY_MS;
}
function parseMs(iso: unknown): number {
  return typeof iso === "string" ? Date.parse(iso) : Number.NaN;
}
function round1(n: number | null): number | null {
  return n == null ? null : Math.round(n * 10) / 10;
}

export type DetalleProyecto = {
  id: string;
  cliente: string | null;
  estado_nombre: string;
  etapa: string;
  tecnico_nombre: string | null;
  dias_en_estado: number | null;
  fecha_prometida: string | null;
};

export type DetalleEntrega = {
  id: string;
  cliente: string | null;
  tecnico_nombre: string | null;
  fecha_entrega: string;
  lead_time_dias: number | null;
  cumplio: boolean | null;
};

export type ProduccionReport = {
  period: string;
  generated_at: string;
  kpis: {
    entregados_mes: number;
    entregados_mes_anterior: number;
    variacion_entregados_pct: number | null;
    wip_activo: number;
    lead_time_mediana_dias: number | null;
    lead_time_p85_dias: number | null;
    cycle_time_mediana_dias: number | null;
    cycle_time_p85_dias: number | null;
    cumplimiento_fecha_prometida_pct: number | null;
    estancados: number;
    cancelados_mes: number;
  };
  salud: {
    clave: string;
    label: string;
    detalle: string;
    tono: "emerald" | "amber" | "rose" | "slate";
    cantidad: number;
  }[];
  higiene_datos: {
    con_fecha_prometida_pct: number;
    con_tecnico_asignado_pct: number;
    con_monto_vendido_pct: number;
    total_activos: number;
  };
  carga_por_tecnico: {
    tecnico_id: string | null;
    tecnico_nombre: string;
    wip: number;
    entregados_mes: number;
    antiguedad_promedio_dias: number | null;
    vencidos: number;
    estancados: number;
  }[];
  wip_por_etapa: { etapa: string; label: string; cantidad: number }[];
  wip_por_estado: { estado_id: string; nombre: string; color: string; sort_order: number; cantidad: number }[];
  aging_buckets: { bucket: "0-7" | "7-15" | "15-30" | "30+"; cantidad: number }[];
  detalle: {
    estancados: DetalleProyecto[];
    por_vencer: DetalleProyecto[];
    sin_tecnico: DetalleProyecto[];
    entregados_mes: DetalleEntrega[];
  };
};

type EstadoRow = {
  id: string;
  codigo: string | null;
  nombre: string | null;
  color: string | null;
  sort_order: number | null;
  tipo_sla: string | null;
  cuenta_sla: boolean | null;
  sla_horas_objetivo: number | null;
  es_estado_final: boolean | null;
  es_estado_inicial: boolean | null;
  activo: boolean | null;
};

type ProyectoRow = {
  id: string;
  estado_id: string;
  etapa_desarrollo: string | null;
  etapa_desarrollo_at: string | null;
  etapa_finalizado_at: string | null;
  tecnico_asignado_at: string | null;
  responsable_tecnico_id: string | null;
  fecha_ingreso: string | null;
  fecha_prometida: string | null;
  monto_vendido: string | number | null;
  updated_at: string | null;
  created_at: string | null;
  cliente_nombre: string | null;
};

const POR_VENCER_DIAS = 3; // ventana para "por vencer" sobre fecha_prometida

export async function getProduccionReport(empresaId: string, period?: string): Promise<ProduccionReport> {
  const pool = getChatPostgresPool();
  if (!pool) throw new Error("Pool Postgres no disponible (SUPABASE_DB_URL)");

  const schema = await fetchDataSchemaForEmpresaId(empresaId);
  const P = quoteSchemaTable(schema, "proyectos");
  const E = quoteSchemaTable(schema, "proyecto_estados");
  const H = quoteSchemaTable(schema, "proyecto_estado_historial");
  const C = quoteSchemaTable(schema, "clientes");

  const ref = periodToDate(period);
  const periodStr = ref.slice(0, 7);
  const mesInicio = ref; // YYYY-MM-01
  const prevDate = new Date(`${ref}T00:00:00Z`);
  prevDate.setUTCMonth(prevDate.getUTCMonth() - 1);
  const prevInicio = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const nextDate = new Date(`${ref}T00:00:00Z`);
  nextDate.setUTCMonth(nextDate.getUTCMonth() + 1);
  const mesFin = `${nextDate.getUTCFullYear()}-${String(nextDate.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const nowMs = Date.now();

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[]): Promise<T[]> =>
    (await pool.query(sql, params)).rows as T[];

  // ── 1. Estados de la empresa (clasificación entrega / cancelación / umbral) ──
  const estados = await q<EstadoRow>(
    `SELECT id, codigo, nombre, color, sort_order, tipo_sla, cuenta_sla, sla_horas_objetivo,
            es_estado_final, es_estado_inicial, activo
       FROM ${E} WHERE empresa_id = $1`,
    [empresaId]
  );
  const estadoById = new Map(estados.map((e) => [e.id, e]));
  const deliveryIds = estados.filter((e) => esEstadoEntrega(e)).map((e) => e.id);
  const cancelIds = estados.filter((e) => esCancelacion(e.codigo)).map((e) => e.id);
  const noWipIds = new Set([...deliveryIds, ...cancelIds]); // estados que NO son WIP

  // ── 2. Proyectos activos (no archivados) + nombre de cliente (join intra-tenant) ──
  const activos = await q<ProyectoRow>(
    `SELECT p.id, p.estado_id, p.etapa_desarrollo, p.etapa_desarrollo_at, p.etapa_finalizado_at,
            p.tecnico_asignado_at, p.responsable_tecnico_id, p.fecha_ingreso, p.fecha_prometida,
            p.monto_vendido, p.updated_at, p.created_at,
            coalesce(nullif(c.empresa, ''), c.nombre_contacto) AS cliente_nombre
       FROM ${P} p
       LEFT JOIN ${C} c ON c.id = p.cliente_id
      WHERE p.empresa_id = $1 AND p.archivado = false`,
    [empresaId]
  );
  const wip = activos.filter((p) => !noWipIds.has(p.estado_id)); // WIP real

  // ── 3. Segmento abierto actual por proyecto (para aging / tiempo en estado) ──
  const openSegRows = await q<{ proyecto_id: string; entered_at: string | null }>(
    `SELECT proyecto_id, max(entered_at) AS entered_at
       FROM ${H} WHERE empresa_id = $1 AND exited_at IS NULL
      GROUP BY proyecto_id`,
    [empresaId]
  );
  const openSegByProyecto = new Map(openSegRows.map((r) => [r.proyecto_id, r.entered_at]));

  // ── 4. Entregas (primera transición a un estado de entrega) por proyecto ──
  type DeliveryHist = { proyecto_id: string; entered_at: string; responsable_tecnico_id: string | null };
  const firstDelivery = new Map<string, DeliveryHist>();
  if (deliveryIds.length) {
    const rows = await q<DeliveryHist>(
      `SELECT proyecto_id, entered_at, responsable_tecnico_id
         FROM ${H}
        WHERE empresa_id = $1 AND estado_nuevo_id = ANY($2::uuid[])
        ORDER BY entered_at ASC`,
      [empresaId, deliveryIds]
    );
    for (const r of rows) {
      if (!firstDelivery.has(r.proyecto_id)) firstDelivery.set(r.proyecto_id, r); // primera = re-entradas no cuentan
    }
  }

  // ── 5. Cancelaciones (primera transición a estado de cancelación) por proyecto ──
  const firstCancel = new Map<string, string>(); // proyecto_id → entered_at
  if (cancelIds.length) {
    const rows = await q<{ proyecto_id: string; entered_at: string }>(
      `SELECT proyecto_id, entered_at FROM ${H}
        WHERE empresa_id = $1 AND estado_nuevo_id = ANY($2::uuid[])
        ORDER BY entered_at ASC`,
      [empresaId, cancelIds]
    );
    for (const r of rows) if (!firstCancel.has(r.proyecto_id)) firstCancel.set(r.proyecto_id, r.entered_at);
  }

  const inMonth = (iso: string, start: string, end: string): boolean => {
    const ms = parseMs(iso);
    return Number.isFinite(ms) && ms >= parseMs(start) && ms < parseMs(end);
  };

  const entregadosMesIds = [...firstDelivery.values()].filter((d) => inMonth(d.entered_at, mesInicio, mesFin));
  const entregadosMesAntCount = [...firstDelivery.values()].filter((d) =>
    inMonth(d.entered_at, prevInicio, mesInicio)
  ).length;
  const canceladosMes = [...firstCancel.values()].filter((iso) => inMonth(iso, mesInicio, mesFin)).length;

  // ── 6. Detalle de proyectos entregados este mes (pueden estar archivados → fetch aparte) ──
  const entregadoIds = entregadosMesIds.map((d) => d.proyecto_id);
  let entregadosDetalle: ProyectoRow[] = [];
  if (entregadoIds.length) {
    entregadosDetalle = await q<ProyectoRow>(
      `SELECT p.id, p.estado_id, p.etapa_desarrollo, p.etapa_desarrollo_at, p.etapa_finalizado_at,
              p.tecnico_asignado_at, p.responsable_tecnico_id, p.fecha_ingreso, p.fecha_prometida,
              p.monto_vendido, p.updated_at, p.created_at,
              coalesce(nullif(c.empresa, ''), c.nombre_contacto) AS cliente_nombre
         FROM ${P} p LEFT JOIN ${C} c ON c.id = p.cliente_id
        WHERE p.empresa_id = $1 AND p.id = ANY($2::uuid[])`,
      [empresaId, entregadoIds]
    );
  }
  const entregadoDetalleById = new Map(entregadosDetalle.map((p) => [p.id, p]));

  // ── 7. Cycle time técnico: finalizados (etapa) este mes con técnico asignado ──
  const cycleRows = await q<{
    tecnico_asignado_at: string | null;
    fecha_ingreso: string | null;
    etapa_finalizado_at: string;
  }>(
    `SELECT tecnico_asignado_at, fecha_ingreso, etapa_finalizado_at
       FROM ${P}
      WHERE empresa_id = $1 AND etapa_desarrollo = 'finalizado'
        AND responsable_tecnico_id IS NOT NULL
        AND etapa_finalizado_at >= $2 AND etapa_finalizado_at < $3`,
    [empresaId, mesInicio, mesFin]
  );

  // ── Cálculos derivados ──

  // Tiempo en estado (segmento abierto) para el WIP, con fallback igual a enrich-proyectos.
  const desdeMsDe = (p: ProyectoRow): number => {
    const open = openSegByProyecto.get(p.id);
    const openMs = parseMs(open);
    if (Number.isFinite(openMs)) return openMs;
    for (const v of [p.updated_at, p.created_at, p.fecha_ingreso]) {
      const ms = parseMs(v);
      if (Number.isFinite(ms)) return ms;
    }
    return Number.NaN;
  };

  type WipCalc = {
    p: ProyectoRow;
    estado: EstadoRow | undefined;
    desdeMs: number;
    diasEnEstado: number | null;
    estancado: boolean;
    esArea: boolean;
    vencidoSla: boolean;
  };
  const wipCalc: WipCalc[] = wip.map((p) => {
    const estado = estadoById.get(p.estado_id);
    const desdeMs = desdeMsDe(p);
    const segundos = Number.isFinite(desdeMs) ? Math.max(0, (nowMs - desdeMs) / 1000) : null;
    const umbral = estado ? umbralEstancadoSegundos(estado) : null;
    const estancado = umbral != null && segundos != null && segundos > umbral;
    const esArea = esResponsabilidadArea(estado?.tipo_sla ?? null);
    const objetivo =
      estado && typeof estado.sla_horas_objetivo === "number" && estado.sla_horas_objetivo > 0
        ? estado.sla_horas_objetivo * 3600
        : null;
    const vencidoSla = estado?.cuenta_sla !== false && objetivo != null && segundos != null && segundos > objetivo;
    return {
      p,
      estado,
      desdeMs,
      diasEnEstado: segundos == null ? null : round1(segundos / 86400),
      estancado,
      esArea,
      vencidoSla,
    };
  });

  const estancadosArea = wipCalc.filter((w) => w.estancado && w.esArea);
  const estancadosCliente = wipCalc.filter((w) => w.estancado && !w.esArea);
  const sinTecnico = wipCalc.filter((w) => !w.p.responsable_tecnico_id);

  // Lead time (ingreso → 1ª entrega) sobre entregados del mes.
  const leadDias: number[] = [];
  for (const d of entregadosMesIds) {
    const det = entregadoDetalleById.get(d.proyecto_id);
    const ingMs = parseMs(det?.fecha_ingreso);
    const entMs = parseMs(d.entered_at);
    if (Number.isFinite(ingMs) && Number.isFinite(entMs)) leadDias.push(diffDias(ingMs, entMs));
  }

  // Cycle time técnico (asignación → etapa_finalizado_at).
  const cycleDias: number[] = [];
  for (const r of cycleRows) {
    // coalesce(tecnico_asignado_at, fecha_ingreso)
    const asignMs = parseMs(r.tecnico_asignado_at);
    const desdeMs = Number.isFinite(asignMs) ? asignMs : parseMs(r.fecha_ingreso);
    const finMs = parseMs(r.etapa_finalizado_at);
    if (Number.isFinite(desdeMs) && Number.isFinite(finMs)) cycleDias.push(diffDias(desdeMs, finMs));
  }

  // Cumplimiento fecha prometida: entregados del mes con fecha_prometida no nula.
  let cumpleDen = 0;
  let cumpleNum = 0;
  for (const d of entregadosMesIds) {
    const det = entregadoDetalleById.get(d.proyecto_id);
    const promMs = parseMs(det?.fecha_prometida);
    if (!Number.isFinite(promMs)) continue;
    cumpleDen += 1;
    if (parseMs(d.entered_at) <= promMs) cumpleNum += 1;
  }
  const cumplimientoPct = cumpleDen === 0 ? null : Math.round((cumpleNum / cumpleDen) * 1000) / 10;

  // ── Higiene de datos (sobre el WIP) ──
  const totalActivos = wip.length;
  const pctDe = (n: number): number => (totalActivos === 0 ? 0 : Math.round((n / totalActivos) * 1000) / 10);
  const higiene = {
    con_fecha_prometida_pct: pctDe(wip.filter((p) => p.fecha_prometida != null).length),
    con_tecnico_asignado_pct: pctDe(wip.filter((p) => p.responsable_tecnico_id != null).length),
    con_monto_vendido_pct: pctDe(wip.filter((p) => num(p.monto_vendido) > 0).length),
    total_activos: totalActivos,
  };

  // ── WIP por estado / etapa ──
  const wipPorEstadoMap = new Map<string, number>();
  for (const p of wip) wipPorEstadoMap.set(p.estado_id, (wipPorEstadoMap.get(p.estado_id) ?? 0) + 1);
  const wip_por_estado = [...wipPorEstadoMap.entries()]
    .map(([estado_id, cantidad]) => {
      const e = estadoById.get(estado_id);
      return {
        estado_id,
        nombre: e?.nombre ?? "—",
        color: e?.color ?? "#64748b",
        sort_order: num(e?.sort_order),
        cantidad,
      };
    })
    .sort((a, b) => a.sort_order - b.sort_order);

  const wipPorEtapaMap = new Map<string, number>();
  for (const p of wip) {
    const etapa = p.etapa_desarrollo ?? "en_desarrollo";
    wipPorEtapaMap.set(etapa, (wipPorEtapaMap.get(etapa) ?? 0) + 1);
  }
  // Todas las etapas, incluso en 0 (el eje técnico tiene un orden fijo conocido).
  const wip_por_etapa = PROYECTO_ETAPAS.map((e) => ({
    etapa: e.codigo,
    label: e.label,
    cantidad: wipPorEtapaMap.get(e.codigo) ?? 0,
  }));

  // ── Aging buckets (sobre WIP) ──
  const buckets: Record<"0-7" | "7-15" | "15-30" | "30+", number> = { "0-7": 0, "7-15": 0, "15-30": 0, "30+": 0 };
  for (const w of wipCalc) {
    const d = w.diasEnEstado;
    if (d == null) continue;
    if (d < 7) buckets["0-7"] += 1;
    else if (d < 15) buckets["7-15"] += 1;
    else if (d < 30) buckets["15-30"] += 1;
    else buckets["30+"] += 1;
  }
  const aging_buckets = (["0-7", "7-15", "15-30", "30+"] as const).map((bucket) => ({ bucket, cantidad: buckets[bucket] }));

  // ── Carga por técnico (WIP + entregados del mes) ──
  // entregados del mes por técnico: snapshot del historial (mismo criterio que entregados-por-tecnico).
  const entregadosPorTecnico = new Map<string | null, number>();
  for (const d of entregadosMesIds) {
    const t = d.responsable_tecnico_id ?? null;
    entregadosPorTecnico.set(t, (entregadosPorTecnico.get(t) ?? 0) + 1);
  }
  const cargaMap = new Map<
    string | null,
    { wip: number; antiguedades: number[]; vencidos: number; estancados: number }
  >();
  for (const w of wipCalc) {
    const t = w.p.responsable_tecnico_id ?? null;
    const cur = cargaMap.get(t) ?? { wip: 0, antiguedades: [], vencidos: 0, estancados: 0 };
    cur.wip += 1;
    const asignMs = parseMs(w.p.tecnico_asignado_at);
    if (Number.isFinite(asignMs)) cur.antiguedades.push(diffDias(asignMs, nowMs));
    if (w.vencidoSla) cur.vencidos += 1;
    if (w.estancado && w.esArea) cur.estancados += 1;
    cargaMap.set(t, cur);
  }
  const tecnicoIds = new Set<string>();
  for (const t of cargaMap.keys()) if (t) tecnicoIds.add(t);
  for (const t of entregadosPorTecnico.keys()) if (t) tecnicoIds.add(t);

  // Hidratar nombres desde el catálogo (usuarios NO está en el schema del tenant).
  const nombreTecnico = new Map<string, string>();
  if (tecnicoIds.size) {
    const catalog = createServiceRoleClient();
    const { data } = await catalog
      .from("usuarios")
      .select("id, nombre")
      .eq("empresa_id", empresaId)
      .in("id", [...tecnicoIds]);
    for (const u of (data ?? []) as { id: string; nombre: string | null }[]) {
      nombreTecnico.set(u.id, u.nombre ?? "—");
    }
  }
  const nombreDe = (id: string | null): string =>
    id == null ? "Sin asignar" : nombreTecnico.get(id) ?? "—";

  const carga_por_tecnico = [...new Set([...cargaMap.keys(), ...entregadosPorTecnico.keys()])]
    .map((tecnico_id) => {
      const c = cargaMap.get(tecnico_id) ?? { wip: 0, antiguedades: [], vencidos: 0, estancados: 0 };
      const antiguedad = c.antiguedades.length
        ? round1(c.antiguedades.reduce((a, b) => a + b, 0) / c.antiguedades.length)
        : null;
      return {
        tecnico_id,
        tecnico_nombre: nombreDe(tecnico_id),
        wip: c.wip,
        entregados_mes: entregadosPorTecnico.get(tecnico_id) ?? 0,
        antiguedad_promedio_dias: antiguedad,
        vencidos: c.vencidos,
        estancados: c.estancados,
      };
    })
    .sort((a, b) => b.wip - a.wip || b.entregados_mes - a.entregados_mes);

  // ── Semáforos de salud ──
  const salud: ProduccionReport["salud"] = [
    {
      clave: "estancados_area",
      label: "Estancados (área)",
      detalle: `${estancadosArea.length} sobre umbral interno`,
      tono: estancadosArea.length === 0 ? "emerald" : estancadosArea.length <= 3 ? "amber" : "rose",
      cantidad: estancadosArea.length,
    },
    {
      clave: "espera_cliente",
      label: "Espera del cliente prolongada",
      detalle: `${estancadosCliente.length} esperando respuesta`,
      tono: "slate",
      cantidad: estancadosCliente.length,
    },
    {
      clave: "sin_tecnico",
      label: "WIP sin técnico asignado",
      detalle: `${sinTecnico.length} sin responsable`,
      tono: sinTecnico.length === 0 ? "emerald" : "amber",
      cantidad: sinTecnico.length,
    },
    {
      clave: "cumplimiento",
      label: "Cumplimiento fecha prometida",
      detalle: cumplimientoPct == null ? "sin datos suficientes" : `${cumplimientoPct}% (${cumpleDen} con fecha)`,
      tono: cumplimientoPct == null ? "slate" : cumplimientoPct >= 80 ? "emerald" : cumplimientoPct >= 50 ? "amber" : "rose",
      cantidad: cumpleDen,
    },
    {
      clave: "higiene_prometida",
      label: "Carga de fecha prometida",
      detalle: `${higiene.con_fecha_prometida_pct}% del WIP con fecha`,
      tono: higiene.con_fecha_prometida_pct >= 70 ? "emerald" : higiene.con_fecha_prometida_pct >= 40 ? "amber" : "rose",
      cantidad: higiene.total_activos,
    },
  ];

  // ── Detalle (hasta 50 filas cada uno) ──
  const toDetalle = (w: WipCalc): DetalleProyecto => ({
    id: w.p.id,
    cliente: w.p.cliente_nombre,
    estado_nombre: w.estado?.nombre ?? "—",
    etapa: etapaLabel(w.p.etapa_desarrollo ?? ""),
    tecnico_nombre: w.p.responsable_tecnico_id ? nombreDe(w.p.responsable_tecnico_id) : null,
    dias_en_estado: w.diasEnEstado,
    fecha_prometida: w.p.fecha_prometida,
  });

  const detEstancados = [...estancadosArea, ...estancadosCliente]
    .sort((a, b) => (b.diasEnEstado ?? 0) - (a.diasEnEstado ?? 0))
    .slice(0, 50)
    .map(toDetalle);

  const porVencerLimiteMs = nowMs + POR_VENCER_DIAS * DAY_MS;
  const detPorVencer = wipCalc
    .filter((w) => {
      const promMs = parseMs(w.p.fecha_prometida);
      return Number.isFinite(promMs) && promMs <= porVencerLimiteMs;
    })
    .sort((a, b) => parseMs(a.p.fecha_prometida) - parseMs(b.p.fecha_prometida))
    .slice(0, 50)
    .map(toDetalle);

  const detSinTecnico = sinTecnico
    .sort((a, b) => (b.diasEnEstado ?? 0) - (a.diasEnEstado ?? 0))
    .slice(0, 50)
    .map(toDetalle);

  const detEntregados: DetalleEntrega[] = entregadosMesIds
    .map((d) => {
      const det = entregadoDetalleById.get(d.proyecto_id);
      const ingMs = parseMs(det?.fecha_ingreso);
      const entMs = parseMs(d.entered_at);
      const lead = Number.isFinite(ingMs) && Number.isFinite(entMs) ? round1(diffDias(ingMs, entMs)) : null;
      const promMs = parseMs(det?.fecha_prometida);
      const cumplio = Number.isFinite(promMs) ? entMs <= promMs : null;
      return {
        id: d.proyecto_id,
        cliente: det?.cliente_nombre ?? null,
        tecnico_nombre: d.responsable_tecnico_id ? nombreDe(d.responsable_tecnico_id) : null,
        fecha_entrega: d.entered_at,
        lead_time_dias: lead,
        cumplio,
      };
    })
    .sort((a, b) => parseMs(b.fecha_entrega) - parseMs(a.fecha_entrega))
    .slice(0, 50);

  return {
    period: periodStr,
    generated_at: new Date().toISOString(),
    kpis: {
      entregados_mes: entregadosMesIds.length,
      entregados_mes_anterior: entregadosMesAntCount,
      variacion_entregados_pct: varPct(entregadosMesIds.length, entregadosMesAntCount),
      wip_activo: wip.length,
      lead_time_mediana_dias: round1(median(leadDias)),
      lead_time_p85_dias: round1(percentile(leadDias, 85)),
      cycle_time_mediana_dias: round1(median(cycleDias)),
      cycle_time_p85_dias: round1(percentile(cycleDias, 85)),
      cumplimiento_fecha_prometida_pct: cumplimientoPct,
      estancados: estancadosArea.length,
      cancelados_mes: canceladosMes,
    },
    salud,
    higiene_datos: higiene,
    carga_por_tecnico,
    wip_por_etapa,
    wip_por_estado,
    aging_buckets,
    detalle: {
      estancados: detEstancados,
      por_vencer: detPorVencer,
      sin_tecnico: detSinTecnico,
      entregados_mes: detEntregados,
    },
  };
}
