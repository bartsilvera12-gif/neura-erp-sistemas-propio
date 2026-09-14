import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { etiquetaVisibleTipoServicio } from "@/lib/clientes/tipo-servicio-catalogo";
import { nombreClienteDisplay } from "@/lib/clientes/display-name";
import { TZ_PY } from "@/lib/format/hora-py";

/**
 * GET /api/reportes/suscripciones
 * Reporte de suscripciones desde la óptica del DUEÑO. Tres números por tipo de servicio
 * (Contable / SaaS / Web…), cada uno respondiendo una pregunta distinta:
 *   • Facturado del mes  → cuánto EMITÍ en cuotas de suscripción este mes.
 *   • Cobrado del mes     → cuánta PLATA ENTRÓ este mes por suscripciones (caja), sin importar de
 *                            qué mes de emisión sea la cuota que se pagó (un atrasado que se puso
 *                            al día cuenta como cobrado de este mes).
 *   • Por cobrar (total)  → cuánto me DEBEN en suscripciones EN TOTAL: TODAS las cuotas impagas de
 *                            cualquier mes (deuda completa, no solo la del mes).
 * Los tres se agregan por tipo (plan de la suscripción, con fallback al tipo del cliente) y son
 * "completos": salen de las facturas/pagos reales, no de la lista de suscripciones activas. La tabla
 * lista las suscripciones ACTIVAS con su cuota, lo cobrado este mes y su deuda total.
 *
 * OJO (calidad de dato): sólo cuenta facturas marcadas `tipo=suscripcion`. Una cuota emitida como
 * "contado" o sin período no entra acá aunque sea de una suscripción (mismo caveat que el libro).
 */

const ESTADOS_CLIENTE_INACTIVO = new Set(["inactivo", "baja", "dado de baja", "suspendido"]);
// Tope de IDs por `.in(...)`: con ~90+ uuids la URL supera el límite del gateway → 502 → data vacío.
const IN_CHUNK = 50;
/** Bucket para facturas/suscripciones sin tipo de servicio definido (coincide con la UI). */
const SIN_TIPO = "__sin_tipo__";

/** Agregado de plata por tipo de servicio. Cada campo responde una pregunta del dueño. */
type Agg = {
  facturado_mes: number; // emitido este mes en cuotas de suscripción
  facturado_mes_ant: number; // idem mes anterior (para la tendencia)
  facturas_mes: number; // cantidad de cuotas emitidas este mes (no anuladas)
  cobrado_mes: number; // caja de suscripciones este mes (1 → hoy), cualquier mes de emisión
  cobrado_mes_ant: number; // caja mismo tramo del mes anterior (1 → mismo día) para la tendencia
  por_cobrar_total: number; // deuda total: saldo de TODAS las cuotas impagas, cualquier mes
  cuotas_impagas: number; // cantidad de cuotas con saldo pendiente (cualquier mes)
};
const emptyAgg = (): Agg => ({
  facturado_mes: 0,
  facturado_mes_ant: 0,
  facturas_mes: 0,
  cobrado_mes: 0,
  cobrado_mes_ant: 0,
  por_cobrar_total: 0,
  cuotas_impagas: 0,
});

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { supabase, auth } = ctx;
    const empresaId = auth.empresa_id;

    // Fechas (hora Paraguay).
    const ym = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: TZ_PY })
      .format(new Date())
      .slice(0, 7);
    const [yy, mm] = ym.split("-").map((x) => parseInt(x, 10));
    const prevMonth = mm === 1 ? 12 : mm - 1;
    const prevYear = mm === 1 ? yy - 1 : yy;
    const ymPrev = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
    const hoy = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: TZ_PY }).format(new Date());
    const diaCorte = parseInt(hoy.slice(8, 10), 10);
    const inicioMes = `${ym}-01`;
    const inicioMesAnt = `${ymPrev}-01`;
    const diasMesAnt = new Date(prevYear, prevMonth, 0).getDate();
    const finMesAntCorte = `${ymPrev}-${String(Math.min(diaCorte, diasMesAnt)).padStart(2, "0")}`;

    // 1) Suscripciones ACTIVAS (para las filas de la tabla).
    const { data: subsData, error: subsErr } = await supabase
      .from("suscripciones")
      .select("id, cliente_id, plan_id, precio, moneda")
      .eq("empresa_id", empresaId)
      .eq("estado", "activa");
    if (subsErr) return NextResponse.json(errorResponse(subsErr.message), { status: 400 });
    const activeSubs = (subsData ?? []) as {
      id: string; cliente_id: string | null; plan_id: string | null; precio: number | null; moneda: string | null;
    }[];

    // 2) Facturas de suscripción del mes actual y del anterior (emitido + estado del mes por sub).
    const { data: factMesData } = await supabase
      .from("facturas")
      .select("suscripcion_id, cliente_id, monto, saldo, estado, periodo_facturado")
      .eq("empresa_id", empresaId)
      .eq("tipo", "suscripcion")
      .in("periodo_facturado", [ym, ymPrev]);
    const factMes = (factMesData ?? []) as {
      suscripcion_id: string | null; cliente_id: string | null; monto: number | null; saldo: number | null; estado: string | null; periodo_facturado: string | null;
    }[];

    // 3) Facturas de suscripción con SALDO pendiente, de CUALQUIER período → deuda total (completa).
    const { data: factDeudaData } = await supabase
      .from("facturas")
      .select("suscripcion_id, cliente_id, saldo, estado")
      .eq("empresa_id", empresaId)
      .eq("tipo", "suscripcion")
      .gt("saldo", 0);
    const factDeuda = (factDeudaData ?? []) as {
      suscripcion_id: string | null; cliente_id: string | null; saldo: number | null; estado: string | null;
    }[];

    // 4) Pagos de suscripción (caja): este mes (1→hoy) y mismo tramo del mes anterior (1→mismo día).
    const { data: pagosData } = await supabase
      .from("pagos")
      .select("monto, fecha_pago, facturas(tipo, suscripcion_id, cliente_id)")
      .eq("empresa_id", empresaId)
      .neq("estado_contable", "revertido")
      .gte("fecha_pago", inicioMesAnt)
      .lte("fecha_pago", hoy);
    const pagos = (pagosData ?? []) as { monto: number | null; fecha_pago: string | null; facturas: unknown }[];
    const pagoFac = (p: { facturas: unknown }) => {
      const raw = p.facturas;
      return (Array.isArray(raw) ? raw[0] ?? null : raw) as
        | { tipo?: string | null; suscripcion_id?: string | null; cliente_id?: string | null }
        | null;
    };

    // 5) Resolver tipo de servicio de cada sub/factura/pago: plan de la suscripción, con fallback al
    //    tipo del cliente. Se arma para TODAS las subs/clientes referenciados (activos o no) para que
    //    los totales sean completos (incluye deuda de suscripciones ya dadas de baja).
    const subIds = [...new Set([
      ...activeSubs.map((s) => s.id),
      ...factMes.map((f) => f.suscripcion_id),
      ...factDeuda.map((f) => f.suscripcion_id),
      ...pagos.map((p) => pagoFac(p)?.suscripcion_id ?? null),
    ].filter(Boolean))] as string[];
    const cliIds = [...new Set([
      ...activeSubs.map((s) => s.cliente_id),
      ...factMes.map((f) => f.cliente_id),
      ...factDeuda.map((f) => f.cliente_id),
      ...pagos.map((p) => pagoFac(p)?.cliente_id ?? null),
    ].filter(Boolean))] as string[];

    // sub → plan_id
    const subToPlan = new Map<string, string>();
    for (let i = 0; i < subIds.length; i += IN_CHUNK) {
      const slice = subIds.slice(i, i + IN_CHUNK);
      const { data } = await supabase.from("suscripciones").select("id, plan_id").in("id", slice);
      for (const s of (data ?? []) as { id: string; plan_id: string | null }[]) {
        if (s?.id && s.plan_id) subToPlan.set(String(s.id), String(s.plan_id));
      }
    }
    // plan → { nombre, tipo, precio }
    const planIds = [...new Set([...subToPlan.values(), ...(activeSubs.map((s) => s.plan_id).filter(Boolean) as string[])])];
    const planMap = new Map<string, { nombre: string; tipo: string; precio: number }>();
    for (let i = 0; i < planIds.length; i += IN_CHUNK) {
      const slice = planIds.slice(i, i + IN_CHUNK);
      const { data } = await supabase.from("planes").select("id, nombre, tipo_servicio, precio").in("id", slice);
      for (const p of (data ?? []) as { id: string; nombre: string | null; tipo_servicio: string | null; precio: number | null }[]) {
        planMap.set(String(p.id), { nombre: (p.nombre ?? "").trim() || "(sin plan)", tipo: (p.tipo_servicio ?? "").trim().toLowerCase(), precio: Number(p.precio) || 0 });
      }
    }
    // cliente → { nombre, tipo, vendedor, vigente }
    const cliMap = new Map<string, { nombre: string; tipo: string; vendedorTexto: string; vendedorUid: string; vigente: boolean }>();
    for (let i = 0; i < cliIds.length; i += IN_CHUNK) {
      const slice = cliIds.slice(i, i + IN_CHUNK);
      const { data } = await supabase
        .from("clientes")
        .select("id, empresa, nombre_contacto, tipo_servicio_cliente, vendedor_asignado, vendedor_usuario_id, estado, deleted_at, baja_operativa_at")
        .in("id", slice);
      for (const c of (data ?? []) as Record<string, unknown>[]) {
        const estado = String(c.estado ?? "activo").trim().toLowerCase();
        const vigente =
          c.deleted_at == null &&
          (c.baja_operativa_at == null || String(c.baja_operativa_at).trim() === "") &&
          !ESTADOS_CLIENTE_INACTIVO.has(estado);
        cliMap.set(String(c.id), {
          nombre: nombreClienteDisplay(c, "(sin nombre)"),
          tipo: String(c.tipo_servicio_cliente ?? "").trim().toLowerCase(),
          vendedorTexto: String(c.vendedor_asignado ?? "").trim(),
          vendedorUid: String(c.vendedor_usuario_id ?? "").trim(),
          vigente,
        });
      }
    }
    // Vendedor: id (catálogo neura.usuarios) → nombre.
    const vendedorUids = [...new Set([...cliMap.values()].map((c) => c.vendedorUid).filter(Boolean))];
    const nombrePorUid = new Map<string, string>();
    for (let i = 0; i < vendedorUids.length; i += IN_CHUNK) {
      const slice = vendedorUids.slice(i, i + IN_CHUNK);
      const { data } = await supabase.from("usuarios").select("id, nombre").eq("empresa_id", empresaId).in("id", slice);
      for (const u of (data ?? []) as { id: string | null; nombre: string | null }[]) {
        const uid = String(u?.id ?? "").trim();
        const nom = String(u?.nombre ?? "").trim();
        if (uid && nom) nombrePorUid.set(uid, nom);
      }
    }
    // Catálogo de tipos (etiquetas legibles: SaaS, Contable, Web…).
    const catalogMap: Record<string, string> = {};
    {
      const { data } = await supabase.from("cliente_tipos_servicio_catalogo").select("slug, nombre").eq("empresa_id", empresaId);
      for (const r of (data ?? []) as { slug: string; nombre: string }[]) {
        if (r?.slug && r.nombre) catalogMap[String(r.slug).toLowerCase()] = r.nombre;
      }
    }

    const tipoDeSub = (subId: string | null | undefined) => {
      if (!subId) return "";
      const planId = subToPlan.get(String(subId));
      return (planId ? planMap.get(planId)?.tipo : "") || "";
    };
    const tipoDeFactura = (subId: string | null | undefined, cliId: string | null | undefined) => {
      const t = tipoDeSub(subId);
      if (t) return t;
      return (cliId ? cliMap.get(String(cliId))?.tipo : "") || "";
    };

    // 6) Agregar por tipo + armar mapas por-sub para la tabla.
    const aggPorTipo = new Map<string, Agg>();
    const addAgg = (tipo: string, field: keyof Agg, val: number) => {
      const key = tipo && tipo.length ? tipo : SIN_TIPO;
      const a = aggPorTipo.get(key) ?? emptyAgg();
      a[field] += val;
      aggPorTipo.set(key, a);
    };
    const factBySub = new Map<string, { estado: string; saldo: number; monto: number }>();
    const anuladaBySub = new Set<string>();
    const adeudadoBySub = new Map<string, number>();
    const cobradoBySub = new Map<string, number>();

    // Facturas del mes / mes anterior → facturado (emitido) por tipo + estado del mes por sub.
    for (const f of factMes) {
      const per = String(f.periodo_facturado ?? "");
      const monto = Number(f.monto) || 0;
      const anulada = String(f.estado ?? "").trim().toLowerCase() === "anulado";
      const tipo = tipoDeFactura(f.suscripcion_id, f.cliente_id);
      if (per === ym) {
        if (anulada) {
          if (f.suscripcion_id) anuladaBySub.add(String(f.suscripcion_id));
          continue;
        }
        addAgg(tipo, "facturado_mes", monto);
        addAgg(tipo, "facturas_mes", 1);
        if (f.suscripcion_id) factBySub.set(String(f.suscripcion_id), { estado: String(f.estado ?? "").trim(), saldo: Number(f.saldo) || 0, monto });
      } else if (per === ymPrev && !anulada) {
        addAgg(tipo, "facturado_mes_ant", monto);
      }
    }
    // Deuda total: saldo de TODAS las cuotas de suscripción impagas, de cualquier mes.
    for (const f of factDeuda) {
      if (String(f.estado ?? "").trim().toLowerCase() === "anulado") continue;
      const saldo = Number(f.saldo) || 0;
      if (saldo <= 0) continue;
      const tipo = tipoDeFactura(f.suscripcion_id, f.cliente_id);
      addAgg(tipo, "por_cobrar_total", saldo);
      addAgg(tipo, "cuotas_impagas", 1);
      if (f.suscripcion_id) adeudadoBySub.set(String(f.suscripcion_id), (adeudadoBySub.get(String(f.suscripcion_id)) ?? 0) + saldo);
    }
    // Pagos de suscripción (caja) → cobrado del mes por tipo (cualquier mes de emisión).
    for (const p of pagos) {
      const fac = pagoFac(p);
      if (!fac || String(fac.tipo ?? "").trim().toLowerCase() !== "suscripcion") continue;
      const fp = String(p.fecha_pago ?? "").slice(0, 10);
      const monto = Number(p.monto) || 0;
      const tipo = tipoDeFactura(fac.suscripcion_id, fac.cliente_id);
      if (fp >= inicioMes && fp <= hoy) {
        addAgg(tipo, "cobrado_mes", monto);
        if (fac.suscripcion_id) cobradoBySub.set(String(fac.suscripcion_id), (cobradoBySub.get(String(fac.suscripcion_id)) ?? 0) + monto);
      } else if (fp >= inicioMesAnt && fp <= finMesAntCorte) {
        addAgg(tipo, "cobrado_mes_ant", monto);
      }
    }

    // 7) Serie de facturado (emitido) de suscripciones — últimos 6 meses (total, para la tendencia).
    const MESES_CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    const periodos6: { ym: string; label: string }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(yy, mm - 1 - i, 1));
      periodos6.push({ ym: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`, label: MESES_CORTOS[d.getUTCMonth()] });
    }
    const emitidoPorPeriodo = new Map<string, number>(periodos6.map((p) => [p.ym, 0]));
    {
      const { data } = await supabase
        .from("facturas")
        .select("monto, estado, periodo_facturado")
        .eq("empresa_id", empresaId)
        .eq("tipo", "suscripcion")
        .in("periodo_facturado", periodos6.map((p) => p.ym));
      for (const f of (data ?? []) as { monto: number | null; estado: string | null; periodo_facturado: string | null }[]) {
        if (String(f.estado ?? "").trim().toLowerCase() === "anulado") continue;
        const per = String(f.periodo_facturado ?? "");
        if (emitidoPorPeriodo.has(per)) emitidoPorPeriodo.set(per, (emitidoPorPeriodo.get(per) ?? 0) + (Number(f.monto) || 0));
      }
    }
    const serie_mrr = periodos6.map((p) => ({ periodo: p.ym, label: p.label, monto: Math.round(emitidoPorPeriodo.get(p.ym) ?? 0) }));

    // 8) Filas de la tabla: suscripciones activas de clientes vigentes.
    const rows = activeSubs
      .map((s) => {
        const cli = s.cliente_id ? cliMap.get(String(s.cliente_id)) ?? null : null;
        if (!cli || !cli.vigente) return null; // solo clientes vigentes
        const plan = s.plan_id ? planMap.get(String(s.plan_id)) ?? null : null;
        const tipoSlug = (plan?.tipo || cli.tipo || "").trim().toLowerCase();
        const monto = s.precio != null && s.precio > 0 ? Number(s.precio) : plan?.precio ?? 0;
        const fact = factBySub.get(String(s.id));
        const anuladaMes = !fact && anuladaBySub.has(String(s.id));
        return {
          cliente: cli.nombre,
          plan: plan?.nombre ?? "(sin plan)",
          tipo_slug: tipoSlug || null,
          tipo_label: tipoSlug ? etiquetaVisibleTipoServicio(tipoSlug, catalogMap) : "Sin tipo",
          monto: Math.round(monto),
          facturado_mes: Math.round(fact?.monto ?? 0),
          saldo_mes: Math.round(fact?.saldo ?? 0),
          cobrado_mes: Math.round(cobradoBySub.get(String(s.id)) ?? 0),
          adeudado_total: Math.round(adeudadoBySub.get(String(s.id)) ?? 0),
          anulada_mes: anuladaMes,
          moneda: String(s.moneda ?? "GS").toUpperCase() === "USD" ? "USD" : "GS",
          vendedor: (cli.vendedorUid ? nombrePorUid.get(cli.vendedorUid) : "") || cli.vendedorTexto || "—",
        };
      })
      .filter((r): r is NonNullable<typeof r> => r != null)
      .sort((a, b) => b.adeudado_total - a.adeudado_total || b.monto - a.monto || a.cliente.localeCompare(b.cliente));

    // 9) Objeto de tipos (con etiqueta) + totales (todos los tipos, para "Todos los tipos").
    const tipos: Record<string, Agg & { label: string }> = {};
    const totales = emptyAgg();
    for (const [slug, a] of aggPorTipo.entries()) {
      const label = slug === SIN_TIPO ? "Sin clasificar" : etiquetaVisibleTipoServicio(slug, catalogMap);
      tipos[slug] = { ...a, label };
      (Object.keys(totales) as (keyof Agg)[]).forEach((k) => {
        totales[k] += a[k];
      });
    }

    return NextResponse.json(
      successResponse({
        periodo: ym,
        periodo_anterior: ymPrev,
        dia_corte: diaCorte,
        serie_mrr,
        tipos,
        totales,
        rows,
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
