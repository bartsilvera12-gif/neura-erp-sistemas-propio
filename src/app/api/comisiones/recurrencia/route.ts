import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { requireComisionesModuleAccess } from "@/lib/comisiones/comisiones-auth";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";
import { nombreClienteDisplay } from "@/lib/clientes/display-name";
import { errorResponse, successResponse } from "@/lib/api/response";
import { TZ_PY } from "@/lib/format/hora-py";

// Reporte en vivo: nunca cachear.
export const dynamic = "force-dynamic";
export const revalidate = 0;
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } as const;

/**
 * GET /api/comisiones/recurrencia?mes=YYYY-MM
 *
 * RECURRENCIA NUEVA del mes por asesor (Paso 1: SOLO LECTURA).
 * = suma de la cuota (suscripciones.precio) de los CLIENTES SaaS/Mixto NUEVOS del mes
 *   (por `clientes.created_at`, ciclo 01→fin de mes = la venta), atribuida al VENDEDOR
 *   del cliente (`clientes.vendedor_usuario_id`).
 *
 * OJO: se cuenta por alta del CLIENTE, no por `suscripciones.created_at` — una suscripción
 * puede crearse después (backfill/lote) para un cliente vendido en un mes anterior, y eso
 * NO es recurrencia nueva de este mes.
 *
 * MÉTRICA SEPARADA: NO suma al revenue del asesor ni toca el cálculo de comisión
 * (`/api/comisiones/preview`). Es solo para VER/MEDIR cuánta recurrencia genera cada asesor.
 * Cómo influye en escalas/premios se define en el Paso 2.
 *
 * Scope: admin empresa/global ve a todos; el resto ve solo lo suyo.
 */

const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const ESTADOS_SUSC_NO_VIGENTE = new Set(["cancelada", "anulada", "anulado", "cancelado"]);

function parseMesYm(request: Request): string {
  const u = new URL(request.url);
  const m = (u.searchParams.get("mes") || u.searchParams.get("month") || "").trim();
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) return m;
  // Default: mes en curso (hora Paraguay).
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: TZ_PY })
    .format(new Date())
    .slice(0, 7);
}

type ItemRecurrencia = {
  suscripcion_id: string;
  cliente: string;
  tipo_cliente: string; // saas | mixto
  plan: string | null;
  monto: number;
  moneda: string;
  fecha: string | null; // created_at (fecha de venta)
};
type VendedorRecurrencia = {
  vendedor_id: string | null;
  vendedor_nombre: string;
  total: number; // Gs
  cantidad: number;
  items: ItemRecurrencia[];
};

export async function GET(request: Request) {
  const auth = await requireComisionesModuleAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status, headers: NO_STORE });
  }

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const empresaId = auth.empresaId;

    const ym = parseMesYm(request);
    const [yy, mm] = ym.split("-").map((x) => parseInt(x, 10));
    const nextYm = mm === 12 ? `${yy + 1}-01` : `${yy}-${String(mm + 1).padStart(2, "0")}`;
    const desde = `${ym}-01`;
    const hasta = `${nextYm}-01`; // exclusivo

    // Scope: solo admin empresa/global ve a todos.
    const verTodo = esRolAdminEmpresaOGlobal(auth.rol);
    const soloVendedorId = verTodo ? null : auth.usuarioCatalogId;

    // 1) CLIENTES SaaS/Mixto NUEVOS del mes (la venta = alta del cliente).
    const { data: cliData, error: cliErr } = await sb
      .from("clientes")
      .select("id, empresa, nombre_contacto, tipo_servicio_cliente, vendedor_usuario_id, created_at")
      .eq("empresa_id", empresaId)
      .in("tipo_servicio_cliente", ["saas", "mixto"])
      .gte("created_at", desde)
      .lt("created_at", hasta);
    if (cliErr) return NextResponse.json(errorResponse(cliErr.message), { status: 400, headers: NO_STORE });
    const cli = new Map<string, { nombre: string; tipo: string; vendedor: string | null; fecha: string | null }>();
    for (const c of (cliData ?? []) as Record<string, unknown>[]) {
      const id = String(c.id ?? "");
      const v = c.vendedor_usuario_id;
      if (soloVendedorId && (typeof v !== "string" || v.trim() !== soloVendedorId)) continue; // scope
      cli.set(id, {
        nombre: nombreClienteDisplay(c, id.slice(0, 8)),
        tipo: String(c.tipo_servicio_cliente ?? "").trim().toLowerCase(),
        vendedor: typeof v === "string" && v.trim() ? v.trim() : null,
        fecha: c.created_at != null ? String(c.created_at).slice(0, 10) : null,
      });
    }
    const clienteIds = [...cli.keys()];

    // 2) Suscripciones de ESOS clientes (vigentes) → cuota. Sumadas por cliente.
    const subsPorCliente = new Map<string, { precio: number; moneda: string; plan_id: string }[]>();
    if (clienteIds.length > 0) {
      const { data: suscData, error: suscErr } = await sb
        .from("suscripciones")
        .select("cliente_id, plan_id, precio, moneda, estado")
        .eq("empresa_id", empresaId)
        .in("cliente_id", clienteIds);
      if (suscErr) return NextResponse.json(errorResponse(suscErr.message), { status: 400, headers: NO_STORE });
      for (const s of (suscData ?? []) as Record<string, unknown>[]) {
        if (ESTADOS_SUSC_NO_VIGENTE.has(String(s.estado ?? "").trim().toLowerCase())) continue;
        const cid = s.cliente_id ? String(s.cliente_id) : "";
        if (!cli.has(cid)) continue;
        const arr = subsPorCliente.get(cid) ?? [];
        arr.push({ precio: Number(s.precio) || 0, moneda: String(s.moneda ?? "GS").toUpperCase() === "USD" ? "USD" : "GS", plan_id: s.plan_id ? String(s.plan_id) : "" });
        subsPorCliente.set(cid, arr);
      }
    }

    // 3) Nombres de plan (para el drill-down).
    const planIds = [...new Set([...subsPorCliente.values()].flat().map((s) => s.plan_id).filter(Boolean))];
    const planNombre = new Map<string, string>();
    if (planIds.length > 0) {
      const { data: planData } = await sb.from("planes").select("id, nombre").in("id", planIds);
      for (const p of (planData ?? []) as { id: string; nombre: string | null }[]) {
        if (p?.id) planNombre.set(String(p.id), (p.nombre ?? "").trim() || "(sin plan)");
      }
    }

    // 4) Agregar por vendedor (un item por CLIENTE nuevo, con su cuota total).
    const porVendedor = new Map<string, VendedorRecurrencia>();
    for (const [cid, c] of cli.entries()) {
      const subs = subsPorCliente.get(cid) ?? [];
      const monto = subs.reduce((s, x) => s + x.precio, 0);
      if (monto <= 0) continue; // cliente nuevo sin cuota vigente → no suma recurrencia
      const moneda = subs.some((x) => x.moneda === "USD") ? "USD" : "GS";
      const plan = subs.map((x) => (x.plan_id ? planNombre.get(x.plan_id) : null)).filter(Boolean).join(" + ") || null;

      const vendId = c.vendedor;
      const key = vendId ?? "__sin_vendedor__";
      const entry = porVendedor.get(key) ?? { vendedor_id: vendId, vendedor_nombre: "", total: 0, cantidad: 0, items: [] };
      entry.total += monto;
      entry.cantidad += 1;
      entry.items.push({
        suscripcion_id: cid,
        cliente: c.nombre,
        tipo_cliente: c.tipo,
        plan,
        monto,
        moneda,
        fecha: c.fecha,
      });
      porVendedor.set(key, entry);
    }

    // 5) Nombres de vendedor.
    const vendIds = [...porVendedor.values()].map((v) => v.vendedor_id).filter((x): x is string => Boolean(x));
    if (vendIds.length > 0) {
      const { data: usrData } = await sb.from("usuarios").select("id, nombre").eq("empresa_id", empresaId).in("id", vendIds);
      const nombreUsr = new Map<string, string>();
      for (const u of (usrData ?? []) as { id: string | null; nombre: string | null }[]) {
        const uid = String(u?.id ?? "").trim();
        const nom = String(u?.nombre ?? "").trim();
        if (uid && nom) nombreUsr.set(uid, nom);
      }
      for (const v of porVendedor.values()) {
        v.vendedor_nombre = v.vendedor_id ? nombreUsr.get(v.vendedor_id) ?? "Sin nombre" : "Sin vendedor";
      }
    } else {
      for (const v of porVendedor.values()) v.vendedor_nombre = v.vendedor_id ? "Sin nombre" : "Sin vendedor";
    }

    const filas = [...porVendedor.values()].sort((a, b) => b.total - a.total);
    for (const f of filas) f.items.sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? ""));
    const total = filas.reduce((s, v) => s + v.total, 0);
    const cantidad = filas.reduce((s, v) => s + v.cantidad, 0);

    return NextResponse.json(
      successResponse({
        meta: {
          periodo: `${MESES[mm - 1]} ${yy}`,
          periodo_mes: ym,
          is_vendedor_view: Boolean(soloVendedorId),
          moneda: "GS",
        },
        total_recurrencia: Math.round(total),
        cantidad_suscripciones: cantidad,
        por_vendedor: filas.map((f) => ({ ...f, total: Math.round(f.total) })),
      }),
      { headers: NO_STORE }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500, headers: NO_STORE });
  }
}
