import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { tipoEsMixto, tipoIncluyeSaas, tipoIncluyeWeb } from "@/lib/proyectos/tipos-proyecto";

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

function ymdEnAsuncion(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Asuncion",
  }).format(d);
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
        "id, titulo, cliente_id, tipo_id, estado_id, responsable_comercial_id, responsable_tecnico_id, brief_data, fecha_ingreso, fecha_prometida, archivado, created_at",
        empresaId
      ),
      fetchAll(sb, "proyecto_estados", "id, nombre, codigo, sort_order, es_estado_final, sla_horas_objetivo, cuenta_sla", empresaId),
      fetchAll(sb, "facturas", "cliente_id, fecha, monto, tipo, estado, suscripcion_id", empresaId),
      fetchAll(sb, "proyecto_estado_historial", "proyecto_id, estado_nuevo_id, entered_at, exited_at", empresaId),
    ]);

    // Solo proyectos vigentes (no archivados). `proys` = universo (para el histórico/gráfico).
    const proys = proysRaw.filter((p) => !p.archivado);

    // Período (opcional): filtra el COHORT por FECHA DE INGRESO. Sin período → todo.
    const url = new URL(request.url);
    const desdeP = (url.searchParams.get("desde") ?? "").slice(0, 10);
    const hastaP = (url.searchParams.get("hasta") ?? "").slice(0, 10);
    const cohortMode = /^\d{4}-\d{2}-\d{2}$/.test(desdeP) && /^\d{4}-\d{2}-\d{2}$/.test(hastaP);
    const cohort = cohortMode
      ? proys.filter((p) => {
          const fi = String(p.fecha_ingreso ?? "").slice(0, 10);
          return fi && fi >= desdeP && fi <= hastaP;
        })
      : proys;

    // Tipos.
    const tipoIds = [...new Set(proys.map((p) => String(p.tipo_id ?? "")).filter(Boolean))];
    const tipoNombre = new Map<string, string>();
    const tipoCodigo = new Map<string, string>();
    for (let i = 0; i < tipoIds.length; i += 120) {
      const slice = tipoIds.slice(i, i + 120);
      const { data } = await sb.from("proyecto_tipos").select("id, nombre, codigo").in("id", slice);
      for (const t of (data ?? []) as Record<string, unknown>[]) {
        tipoNombre.set(String(t.id), String(t.nombre ?? ""));
        tipoCodigo.set(String(t.id), String(t.codigo ?? ""));
      }
    }

    /**
     * Bucket EXCLUSIVO del proyecto para "Entregados por mes": cada proyecto
     * cuenta en un solo grupo, así la suma de los tres coincide siempre con el
     * total del mes. El tipo mixto ("Página Web + SaaS/ERP") es su propio
     * bucket y no se reparte entre los otros dos — contarlo en ambos inflaría
     * el total del mes por encima de la cantidad real de entregas.
     */
    function bucketDeTipo(tipoId: unknown): "web" | "saas" | "mixto" | "otros" {
      const codigo = tipoCodigo.get(String(tipoId ?? "")) ?? "";
      if (tipoEsMixto(codigo)) return "mixto";
      if (tipoIncluyeWeb(codigo)) return "web";
      if (tipoIncluyeSaas(codigo)) return "saas";
      return "otros";
    }

    // Nombres de usuarios (comercial + técnico).
    const comIds = [
      ...new Set(
        proys.flatMap((p) => [
          String(p.responsable_comercial_id ?? ""),
          String(p.responsable_tecnico_id ?? ""),
        ]).filter(Boolean)
      ),
    ];
    const comNombre = new Map<string, string>();
    for (let i = 0; i < comIds.length; i += 120) {
      const slice = comIds.slice(i, i + 120);
      const { data } = await catalog.from("usuarios").select("id, nombre").eq("empresa_id", empresaId).in("id", slice);
      for (const u of (data ?? []) as Record<string, unknown>[]) comNombre.set(String(u.id), String(u.nombre ?? "").trim());
    }

    // Labels de cliente por proyecto (para los detalles).
    const cliIds = [...new Set(proys.map((p) => String(p.cliente_id ?? "")).filter(Boolean))];
    const cliLabel = new Map<string, string>();
    for (let i = 0; i < cliIds.length; i += 120) {
      const slice = cliIds.slice(i, i + 120);
      const { data } = await sb.from("clientes").select("id, empresa, nombre_contacto").in("id", slice);
      for (const c of (data ?? []) as Record<string, unknown>[]) {
        const label = String(c.empresa ?? "").trim() || String(c.nombre_contacto ?? "").trim() || "—";
        cliLabel.set(String(c.id), label);
      }
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
    // Presupuesto por PROYECTO: la venta del cliente (primera factura) se cuenta UNA sola vez, en
    // su proyecto más antiguo (por fecha de ingreso). Si el cliente tiene varios proyectos, los
    // demás no vuelven a sumar (evita duplicar la misma venta en asesor/técnico/estado/total).
    const presupuestoPorProyecto = new Map<string, number>();
    {
      const porCli = new Map<string, Record<string, unknown>[]>();
      for (const p of proys) {
        const cid = String(p.cliente_id ?? "");
        if (!cid) continue;
        const arr = porCli.get(cid) ?? [];
        arr.push(p);
        porCli.set(cid, arr);
      }
      for (const [cid, ps] of porCli) {
        const monto = presupuestoPorCliente.get(cid) ?? 0;
        ps.sort(
          (a, b) =>
            String(a.fecha_ingreso ?? "").localeCompare(String(b.fecha_ingreso ?? "")) ||
            String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""))
        );
        ps.forEach((p, i) => presupuestoPorProyecto.set(String(p.id), i === 0 ? monto : 0));
      }
    }
    const presupuestoDe = (p: Record<string, unknown>) => presupuestoPorProyecto.get(String(p.id)) ?? 0;

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

    // Historial: por proyecto, cuándo entró a su estado ACTUAL (para SLA/antigüedad); y entrega
    // (entró a estado "Entregado") con su fecha, para agrupar por mes.
    const entradaEstadoActual = new Map<string, number>(); // proyecto_id → ms
    const entregaMs = new Map<string, number>(); // proyecto_id → ms de la ÚLTIMA entrada a Entregado
    const proyEstadoActual = new Map(proys.map((p) => [String(p.id), String(p.estado_id ?? "")]));
    for (const h of histRaw) {
      const pid = String(h.proyecto_id ?? "");
      const est = String(h.estado_nuevo_id ?? "");
      const enteredMs = h.entered_at ? Date.parse(String(h.entered_at)) : NaN;
      if (!pid || !Number.isFinite(enteredMs)) continue;
      if (est === proyEstadoActual.get(pid)) {
        const prev = entradaEstadoActual.get(pid);
        if (prev == null || enteredMs > prev) entradaEstadoActual.set(pid, enteredMs);
      }
      if (entregadoEstadoIds.has(est)) {
        const prev = entregaMs.get(pid);
        if (prev == null || enteredMs > prev) entregaMs.set(pid, enteredMs);
      }
    }
    // ── Agregaciones ──
    const now = Date.now();
    const ymActual = ymEnAsuncion(new Date());
    const entregaYm = (pid: string): string | null => {
      const ms = entregaMs.get(pid);
      return ms != null ? ymEnAsuncion(new Date(ms)) : null;
    };
    // Para las vistas POR PERSONA (asesor / técnico): un proyecto entregado en un mes anterior deja
    // de contar en la carga de esa persona (y en su presupuesto). Se mantienen los activos y lo
    // entregado este mes. El resto del panel (por estado / KPIs / histórico) sigue mostrando todo.
    const entregadoMesAnterior = (p: Record<string, unknown>) => {
      const meta = estMeta.get(String(p.estado_id ?? ""));
      return !!(meta?.final && !meta.cancel && entregaYm(String(p.id)) !== ymActual);
    };

    // Detalle de un proyecto para los drill-down (por asesor / por técnico): etapa, monto y SLA.
    const proyectoDetalle = (p: Record<string, unknown>) => {
      const eid = String(p.estado_id ?? "");
      const meta = estMeta.get(eid);
      const entered = entradaEstadoActual.get(String(p.id));
      const diasEnEstado = entered != null ? Math.max(0, Math.floor((now - entered) / 86400000)) : null;
      let slaVencido = false;
      let slaTexto = "sin SLA";
      if (meta && meta.cuentaSla && meta.slaHoras != null && !meta.final) {
        const objMs = meta.slaHoras * 3600 * 1000;
        if (entered != null) {
          const transc = now - entered;
          slaVencido = transc > objMs;
          slaTexto = slaVencido
            ? `Vencido (${Math.floor((transc - objMs) / 86400000)}d)`
            : `${Math.max(0, Math.ceil((objMs - transc) / 86400000))}d restantes`;
        }
      } else if (meta?.final) {
        slaTexto = "—";
      }
      return {
        id: String(p.id),
        titulo: String(p.titulo ?? "").trim() || "(sin título)",
        cliente: cliLabel.get(String(p.cliente_id ?? "")) ?? "—",
        estado: meta?.nombre ?? "(sin estado)",
        estado_orden: meta?.orden ?? 99,
        es_final: meta?.final ?? false,
        vendedor: (() => {
          const k = String(p.responsable_comercial_id ?? "");
          return k ? comNombre.get(k) || "—" : "Sin asignar";
        })(),
        presupuesto: Math.round(presupuestoDe(p)),
        dias_en_estado: diasEnEstado,
        sla_vencido: slaVencido,
        sla_texto: slaTexto,
      };
    };

    // Por estado (cantidad + presupuesto) + SLA vencidos. Se muestra TODO el universo de proyectos
    // no archivados (todos los estados, incluidos los entregados de cualquier mes). El desglose
    // mensual de entregas vive en "Entregados por mes".
    const porEstadoMap = new Map<string, { cantidad: number; presupuesto: number; vencidos: number }>();
    for (const p of cohort) {
      const eid = String(p.estado_id ?? "");
      const meta = estMeta.get(eid);
      const agg = porEstadoMap.get(eid) ?? { cantidad: 0, presupuesto: 0, vencidos: 0 };
      agg.cantidad += 1;
      agg.presupuesto += presupuestoDe(p);
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

    type DetalleProy = ReturnType<typeof proyectoDetalle>;
    // Orden: por estado (orden del pipeline), luego SLA vencido primero, luego presupuesto desc.
    const ordenarProys = (arr: DetalleProy[]) =>
      arr.sort(
        (a, b) =>
          a.estado_orden - b.estado_orden ||
          Number(b.sla_vencido) - Number(a.sla_vencido) ||
          b.presupuesto - a.presupuesto
      );

    // Por asesor. Solo carga vigente: activos + entregados este mes (los entregados de meses
    // anteriores no aparecen ni suman presupuesto).
    const porAseMap = new Map<string, { cantidad: number; presupuesto: number; proyectos: DetalleProy[] }>();
    for (const p of cohort) {
      if (entregadoMesAnterior(p)) continue;
      const k = String(p.responsable_comercial_id ?? "");
      const agg = porAseMap.get(k) ?? { cantidad: 0, presupuesto: 0, proyectos: [] };
      agg.cantidad += 1;
      agg.presupuesto += presupuestoDe(p);
      agg.proyectos.push(proyectoDetalle(p));
      porAseMap.set(k, agg);
    }
    const por_asesor = [...porAseMap.entries()]
      .map(([k, v]) => ({
        asesor: k ? comNombre.get(k) || k.slice(0, 8) : "Sin asignar",
        cantidad: v.cantidad,
        presupuesto: Math.round(v.presupuesto),
        proyectos: ordenarProys(v.proyectos),
      }))
      .sort((a, b) => b.presupuesto - a.presupuesto || b.cantidad - a.cantidad);

    // Por técnico (responsable técnico) — carga vigente: activos + entregados este mes.
    const porTecMap = new Map<string, { cantidad: number; presupuesto: number; proyectos: DetalleProy[] }>();
    for (const p of cohort) {
      if (entregadoMesAnterior(p)) continue;
      const k = String(p.responsable_tecnico_id ?? "");
      const agg = porTecMap.get(k) ?? { cantidad: 0, presupuesto: 0, proyectos: [] };
      agg.cantidad += 1;
      agg.presupuesto += presupuestoDe(p);
      agg.proyectos.push(proyectoDetalle(p));
      porTecMap.set(k, agg);
    }
    const por_tecnico = [...porTecMap.entries()]
      .map(([k, v]) => ({
        tecnico: k ? comNombre.get(k) || k.slice(0, 8) : "Sin asignar",
        cantidad: v.cantidad,
        presupuesto: Math.round(v.presupuesto),
        proyectos: ordenarProys(v.proyectos),
      }))
      .sort((a, b) => b.cantidad - a.cantidad || b.presupuesto - a.presupuesto);

    // Por tipo.
    const porTipoMap = new Map<string, { cantidad: number; presupuesto: number }>();
    for (const p of cohort) {
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
    for (const p of cohort) {
      const bd = p.brief_data && typeof p.brief_data === "object" && !Array.isArray(p.brief_data)
        ? (p.brief_data as Record<string, unknown>)
        : {};
      const rubro = String(bd.tipo_web ?? "").trim() || "Sin rubro";
      porRubroMap.set(rubro, (porRubroMap.get(rubro) ?? 0) + 1);
    }
    const por_rubro = [...porRubroMap.entries()]
      .map(([rubro, cantidad]) => ({ rubro, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad);

    // Entregados por mes (distinct proyecto por su mes de entrega) + detalle para el histórico.
    const entregadoMesProy = new Map<string, Set<string>>();
    for (const [pid, ms] of entregaMs) {
      const ym = ymEnAsuncion(new Date(ms));
      if (!entregadoMesProy.has(ym)) entregadoMesProy.set(ym, new Set());
      entregadoMesProy.get(ym)!.add(pid);
    }
    const proyById = new Map(proys.map((p) => [String(p.id), p]));
    const meses6: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      meses6.push(ymEnAsuncion(d));
    }
    const BUCKET_LABEL: Record<ReturnType<typeof bucketDeTipo>, string> = {
      web: "Proyecto Web",
      saas: "SaaS / ERP",
      mixto: "Página Web + SaaS/ERP",
      otros: "Sin tipo",
    };

    /** `filtroBucket` opcional: sólo entra al detalle el proyecto de ese bucket. */
    const detalleMes = (ym: string, filtroBucket?: ReturnType<typeof bucketDeTipo>) => {
      const set = entregadoMesProy.get(ym) ?? new Set<string>();
      return [...set]
        .map((pid) => {
          const p = proyById.get(pid);
          if (!p) return null;
          const bucket = bucketDeTipo(p.tipo_id);
          if (filtroBucket && bucket !== filtroBucket) return null;
          const ms = entregaMs.get(pid);
          return {
            id: pid,
            titulo: String(p.titulo ?? "").trim() || "(sin título)",
            cliente: cliLabel.get(String(p.cliente_id ?? "")) ?? "—",
            monto: Math.round(presupuestoDe(p)),
            fecha: ms != null ? new Date(ms).toISOString().slice(0, 10) : null,
            tipo: BUCKET_LABEL[bucket],
          };
        })
        .filter((x): x is NonNullable<typeof x> => x != null)
        .sort((a, b) => b.monto - a.monto || (b.fecha ?? "").localeCompare(a.fecha ?? ""));
    };
    const resumenMes = (proyectos: ReturnType<typeof detalleMes>) => ({
      cantidad: proyectos.length,
      monto: proyectos.reduce((a, x) => a + x.monto, 0),
      proyectos,
    });
    // "Web" y "SaaS/ERP" son EXCLUSIVOS entre sí (el mixto va aparte, ver
    // `bucketDeTipo`), así que `web.cantidad + saas.cantidad + mixto.cantidad`
    // da siempre el total del mes — no hay entregas contadas dos veces.
    const entregados_por_mes = meses6.map((ym) => ({
      ym,
      ...resumenMes(detalleMes(ym)),
      web: resumenMes(detalleMes(ym, "web")),
      saas: resumenMes(detalleMes(ym, "saas")),
      mixto: resumenMes(detalleMes(ym, "mixto")),
    }));
    // Entregados DEL PERÍODO (por fecha de entrega). Sin período → mes en curso.
    const [yyE, mmE] = ymActual.split("-").map((x) => parseInt(x, 10));
    const lastDayE = new Date(yyE, mmE, 0).getDate();
    const effDesde = cohortMode ? desdeP : `${ymActual}-01`;
    const effHasta = cohortMode ? hastaP : `${ymActual}-${String(lastDayE).padStart(2, "0")}`;
    let entregadosPeriodoN = 0;
    let entregados_mes_monto = 0;
    for (const [pid, ms] of entregaMs) {
      const p = proyById.get(pid);
      if (!p) continue; // solo no archivados
      const d = ymdEnAsuncion(new Date(ms));
      if (d >= effDesde && d <= effHasta) {
        entregadosPeriodoN += 1;
        entregados_mes_monto += presupuestoDe(p);
      }
    }

    // KPIs — sobre el COHORT (proyectos ingresados en el período); entregados por fecha de entrega.
    const presupuestoTotal = cohort.reduce((a, p) => a + presupuestoDe(p), 0);
    const conPresupuesto = cohort.filter((p) => presupuestoDe(p) > 0).length;
    const activosNoFinal = cohort.filter((p) => !(estMeta.get(String(p.estado_id ?? ""))?.final)).length;
    const vencidosTotal = por_estado.reduce((a, e) => a + e.sla_vencidos, 0);

    return NextResponse.json(
      successResponse({
        kpis: {
          total: cohort.length,
          en_curso: activosNoFinal,
          entregados_mes: entregadosPeriodoN,
          entregados_mes_monto: Math.round(entregados_mes_monto),
          presupuesto_total: Math.round(presupuestoTotal),
          con_presupuesto: conPresupuesto,
          ticket_promedio: conPresupuesto > 0 ? Math.round(presupuestoTotal / conPresupuesto) : 0,
          sla_vencidos: vencidosTotal,
        },
        por_estado,
        por_asesor,
        por_tecnico,
        por_tipo,
        por_rubro,
        entregados_por_mes,
        periodo_ym: ymActual,
        periodo_filtrado: cohortMode,
        periodo_desde: effDesde,
        periodo_hasta: effHasta,
      })
    );
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error"), { status: 500 });
  }
}
