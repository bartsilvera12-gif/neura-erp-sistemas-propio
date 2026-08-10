import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { etiquetaVisibleTipoServicio } from "@/lib/clientes/tipo-servicio-catalogo";

/**
 * GET /api/reportes/suscripciones
 * Reporte de suscripciones ACTIVAS de clientes vigentes: una fila por suscripción con
 * cliente, plan, tipo de servicio (del plan, con fallback al cliente), monto mensual, vendedor
 * asignado y el estado de cobro del MES ACTUAL (Pagado / Pendiente / Sin facturar).
 *
 * "Estado del mes" = factura tipo=suscripcion con periodo_facturado = mes actual para esa
 * suscripción: saldo 0/Pagado → Pagado; saldo > 0 → Pendiente; sin factura del mes → Sin facturar.
 */

const ESTADOS_CLIENTE_INACTIVO = new Set(["inactivo", "baja", "dado de baja", "suspendido"]);

type FacturaRow = { suscripcion_id: string | null; estado: string | null; saldo: number | null };

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { supabase, auth } = ctx;
    const empresaId = auth.empresa_id;

    // Período (mes) actual en hora de Paraguay → "YYYY-MM".
    const ym = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      timeZone: "America/Asuncion",
    })
      .format(new Date())
      .slice(0, 7);

    // 1) Suscripciones activas.
    const { data: subsData, error: subsErr } = await supabase
      .from("suscripciones")
      .select("id, cliente_id, plan_id, precio, moneda")
      .eq("empresa_id", empresaId)
      .eq("estado", "activa");
    if (subsErr) {
      return NextResponse.json(errorResponse(subsErr.message), { status: 400 });
    }
    const subs = (subsData ?? []) as {
      id: string;
      cliente_id: string | null;
      plan_id: string | null;
      precio: number | null;
      moneda: string | null;
    }[];
    if (subs.length === 0) {
      return NextResponse.json(successResponse({ periodo: ym, rows: [] }));
    }

    // 2) Planes (nombre, tipo_servicio, precio fallback).
    const planIds = [...new Set(subs.map((s) => s.plan_id).filter(Boolean))] as string[];
    const planMap = new Map<string, { nombre: string; tipo: string; precio: number }>();
    for (let i = 0; i < planIds.length; i += 150) {
      const slice = planIds.slice(i, i + 150);
      const { data } = await supabase.from("planes").select("id, nombre, tipo_servicio, precio").in("id", slice);
      for (const p of (data ?? []) as { id: string; nombre: string | null; tipo_servicio: string | null; precio: number | null }[]) {
        planMap.set(String(p.id), {
          nombre: (p.nombre ?? "").trim() || "(sin plan)",
          tipo: (p.tipo_servicio ?? "").trim().toLowerCase(),
          precio: Number(p.precio) || 0,
        });
      }
    }

    // 3) Clientes (nombre, tipo, vendedor, vigencia).
    const cliIds = [...new Set(subs.map((s) => s.cliente_id).filter(Boolean))] as string[];
    const cliMap = new Map<
      string,
      {
        nombre: string;
        tipo: string;
        vendedorTexto: string;
        vendedorUid: string;
        vigente: boolean;
      }
    >();
    for (let i = 0; i < cliIds.length; i += 150) {
      const slice = cliIds.slice(i, i + 150);
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
          nombre:
            (String(c.empresa ?? "").trim() || String(c.nombre_contacto ?? "").trim() || "(sin nombre)"),
          tipo: String(c.tipo_servicio_cliente ?? "").trim().toLowerCase(),
          vendedorTexto: String(c.vendedor_asignado ?? "").trim(),
          vendedorUid: String(c.vendedor_usuario_id ?? "").trim(),
          vigente,
        });
      }
    }

    // 3b) Nombre del vendedor por ID: clientes.vendedor_usuario_id = neura.usuarios.id (id del
    //     catálogo, NO auth_user_id — mismo cruce que /api/clientes). Fallback: texto vendedor_asignado.
    const vendedorUids = [...new Set([...cliMap.values()].map((c) => c.vendedorUid).filter(Boolean))];
    const nombrePorUid = new Map<string, string>();
    for (let i = 0; i < vendedorUids.length; i += 150) {
      const slice = vendedorUids.slice(i, i + 150);
      const { data } = await supabase
        .from("usuarios")
        .select("id, nombre")
        .eq("empresa_id", empresaId)
        .in("id", slice);
      for (const u of (data ?? []) as { id: string | null; nombre: string | null }[]) {
        const uid = String(u?.id ?? "").trim();
        const nom = String(u?.nombre ?? "").trim();
        if (uid && nom) nombrePorUid.set(uid, nom);
      }
    }

    // Mes anterior (para el comparativo del semicírculo).
    const [yy, mm] = ym.split("-").map((x) => parseInt(x, 10));
    const prevMonth = mm === 1 ? 12 : mm - 1;
    const prevYear = mm === 1 ? yy - 1 : yy;
    const ymPrev = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;

    // 4) Facturas de suscripción del mes actual (estado por suscripción) + totales facturados
    //    de este mes y del anterior (para comparar cuánta plata mueven las suscripciones).
    const factBySub = new Map<string, { estado: string; saldo: number }>();
    let totalMes = 0;
    let totalMesAnterior = 0;
    {
      const { data } = await supabase
        .from("facturas")
        .select("suscripcion_id, estado, saldo, monto, periodo_facturado")
        .eq("empresa_id", empresaId)
        .eq("tipo", "suscripcion")
        .in("periodo_facturado", [ym, ymPrev]);
      for (const f of (data ?? []) as (FacturaRow & { monto: number | null; periodo_facturado: string | null })[]) {
        const per = String(f.periodo_facturado ?? "");
        const monto = Number(f.monto) || 0;
        const anulada = String(f.estado ?? "").trim().toLowerCase() === "anulado";
        if (anulada) continue; // no cuenta como plata ni como estado del mes
        if (per === ym) {
          totalMes += monto;
          if (f.suscripcion_id) {
            factBySub.set(String(f.suscripcion_id), {
              estado: String(f.estado ?? "").trim(),
              saldo: Number(f.saldo) || 0,
            });
          }
        } else if (per === ymPrev) {
          totalMesAnterior += monto;
        }
      }
    }

    // 4b) COBRADO de suscripciones A LA FECHA DEL DÍA: pagos imputados a facturas tipo=suscripcion,
    //     este mes (1 → hoy) vs mes anterior (1 → mismo día), para comparar el ritmo de cobro.
    const hoy = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: "America/Asuncion",
    }).format(new Date());
    const diaCorte = parseInt(hoy.slice(8, 10), 10);
    const inicioMes = `${ym}-01`;
    const inicioMesAnt = `${ymPrev}-01`;
    const diasMesAnt = new Date(prevYear, prevMonth, 0).getDate(); // días del mes anterior
    const finMesAntCorte = `${ymPrev}-${String(Math.min(diaCorte, diasMesAnt)).padStart(2, "0")}`;
    let cobradoMes = 0;
    let cobradoMesAnterior = 0;
    {
      const { data } = await supabase
        .from("pagos")
        .select("monto, fecha_pago, facturas(tipo)")
        .eq("empresa_id", empresaId)
        .gte("fecha_pago", inicioMesAnt)
        .lte("fecha_pago", hoy);
      for (const p of (data ?? []) as { monto: number | null; fecha_pago: string | null; facturas: unknown }[]) {
        const facRaw = p.facturas;
        const fac = (Array.isArray(facRaw) ? facRaw[0] : facRaw) as { tipo?: string | null } | null;
        if (!fac || String(fac.tipo ?? "").trim().toLowerCase() !== "suscripcion") continue; // solo suscripciones
        const fp = String(p.fecha_pago ?? "").slice(0, 10);
        const monto = Number(p.monto) || 0;
        if (fp >= inicioMes && fp <= hoy) cobradoMes += monto;
        else if (fp >= inicioMesAnt && fp <= finMesAntCorte) cobradoMesAnterior += monto;
      }
    }

    // 5) Catálogo de tipos para etiquetas legibles (SaaS, Contable, Web…).
    const catalogMap: Record<string, string> = {};
    {
      const { data } = await supabase
        .from("cliente_tipos_servicio_catalogo")
        .select("slug, nombre")
        .eq("empresa_id", empresaId);
      for (const r of (data ?? []) as { slug: string; nombre: string }[]) {
        if (r?.slug && r.nombre) catalogMap[String(r.slug).toLowerCase()] = r.nombre;
      }
    }

    const rows = subs
      .map((s) => {
        const cli = s.cliente_id ? cliMap.get(String(s.cliente_id)) ?? null : null;
        if (!cli || !cli.vigente) return null; // solo clientes vigentes
        const plan = s.plan_id ? planMap.get(String(s.plan_id)) ?? null : null;
        const tipoSlug = (plan?.tipo || cli.tipo || "").trim().toLowerCase();
        const monto = s.precio != null && s.precio > 0 ? Number(s.precio) : plan?.precio ?? 0;
        const fact = factBySub.get(String(s.id));
        const estadoMes = !fact
          ? "sin_facturar"
          : fact.saldo <= 0 || fact.estado.toLowerCase() === "pagado"
            ? "pagado"
            : "pendiente";
        return {
          cliente: cli.nombre,
          plan: plan?.nombre ?? "(sin plan)",
          tipo_slug: tipoSlug || null,
          tipo_label: tipoSlug ? etiquetaVisibleTipoServicio(tipoSlug, catalogMap) : "Sin tipo",
          monto: Math.round(monto),
          moneda: String(s.moneda ?? "GS").toUpperCase() === "USD" ? "USD" : "GS",
          vendedor: (cli.vendedorUid ? nombrePorUid.get(cli.vendedorUid) : "") || cli.vendedorTexto || "—",
          estado_mes: estadoMes as "pagado" | "pendiente" | "sin_facturar",
        };
      })
      .filter((r): r is NonNullable<typeof r> => r != null)
      .sort((a, b) => b.monto - a.monto || a.cliente.localeCompare(b.cliente));

    return NextResponse.json(
      successResponse({
        periodo: ym,
        periodo_anterior: ymPrev,
        dia_corte: diaCorte,
        total_mes: Math.round(totalMes),
        total_mes_anterior: Math.round(totalMesAnterior),
        cobrado_mes: Math.round(cobradoMes),
        cobrado_mes_anterior: Math.round(cobradoMesAnterior),
        rows,
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
