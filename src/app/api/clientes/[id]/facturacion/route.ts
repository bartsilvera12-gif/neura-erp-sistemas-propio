import { NextRequest, NextResponse } from "next/server";
import { getFacturasSupabaseFromAuth } from "@/lib/facturacion/facturas-service-client";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";


/** Suma n meses a un período YYYY-MM. Devuelve YYYY-MM. */
function addMeses(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const total = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/**
 * Cuántos meses proyectados (sin factura) se ofrecen SIEMPRE por delante del último
 * período con factura (o del mes corriente, el que sea mayor). Así nunca te quedás sin
 * filas "Emitir" para adelantar cuotas manualmente, sin importar `duracion_meses`.
 */
const HORIZONTE_PROYECCION = 12;

/**
 * Ventana RODANTE de meses a mostrar (YYYY-MM, ascendente):
 *  - desde `fechaInicio` (historia completa de la suscripción)
 *  - hasta `max(mes corriente, último mes facturado) + HORIZONTE_PROYECCION`
 * Ya NO se usa `duracion_meses`: la emisión es abierta (el cron factura para siempre
 * mientras la suscripción esté activa), así que la proyección también debe serlo.
 */
function generarMeses(fechaInicio: string, mesCorriente: string, ultimoMesFacturado: string | null): string[] {
  const inicio = fechaInicio.slice(0, 7);
  const ancla = ultimoMesFacturado && ultimoMesFacturado > mesCorriente ? ultimoMesFacturado : mesCorriente;
  const fin = addMeses(ancla, HORIZONTE_PROYECCION);
  // Si la fecha de inicio fuese posterior al fin (caso raro), al menos el propio inicio.
  const desde = inicio < fin ? inicio : fin;
  const meses: string[] = [];
  let cur = desde;
  while (cur <= fin) {
    meses.push(cur);
    cur = addMeses(cur, 1);
  }
  return meses;
}

/**
 * GET /api/clientes/:id/facturacion
 * Obtiene la facturación proyectada del cliente (suscripción activa).
 * Retorna [{ mes, estado, factura_id }] - estado: "emitida" | "proyectada"
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getFacturasSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;

    const { id: clienteId } = await params;
    if (!clienteId) {
      return NextResponse.json(errorResponse("cliente_id es obligatorio"), { status: 400 });
    }


    const { data: suscripcion, error: errSusc } = await supabase
      .from("suscripciones")
      .select("*")
      .eq("cliente_id", clienteId)
      .eq("empresa_id", auth.empresa_id)
      .eq("estado", "activa")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (errSusc) {
      return NextResponse.json(errorResponse(errSusc.message), { status: 400 });
    }

    if (!suscripcion) {
      return NextResponse.json(
        successResponse({ facturacion: [], suscripcion: null })
      );
    }

    const hoy = new Date().toISOString().slice(0, 10);
    const { data: facturas, error: errFact } = await supabase
      .from("facturas")
      .select("id, fecha, fecha_vencimiento, saldo, estado, monto")
      .eq("cliente_id", clienteId)
      .eq("suscripcion_id", suscripcion.id)
      .eq("empresa_id", auth.empresa_id);

    if (errFact) {
      return NextResponse.json(errorResponse(errFact.message), { status: 400 });
    }

    const facturasPorMes = new Map<string, { id: string; saldo: number; fecha_vencimiento: string; estado: string; monto: number }>();
    for (const f of facturas ?? []) {
      const mes = (f.fecha as string).slice(0, 7);
      if (!facturasPorMes.has(mes)) {
        const saldo = Number(f.saldo ?? 0);
        const estaVencida = saldo > 0 && (f.fecha_vencimiento as string) < hoy;
        facturasPorMes.set(mes, {
          id: f.id,
          saldo,
          fecha_vencimiento: f.fecha_vencimiento as string,
          estado: estaVencida ? "Vencido" : (f.estado as string),
          monto: Number(f.monto) || 0,
        });
      }
    }

    // Ventana rodante: desde el inicio hasta HORIZONTE meses por delante del último
    // período facturado (o del mes corriente). Garantiza filas "proyectada" para emitir.
    const ultimoMesFacturado = facturasPorMes.size > 0 ? [...facturasPorMes.keys()].sort().at(-1)! : null;
    const meses = generarMeses(suscripcion.fecha_inicio, hoy.slice(0, 7), ultimoMesFacturado);

    // Cambio de plan PROGRAMADO: desde qué mes rige el precio nuevo (YYYY-MM). Así la proyección
    // muestra el plan/precio nuevo desde su mes de vigencia, en vez del plan viejo.
    const vigDesdeMes = suscripcion.plan_pendiente_id
      ? String(suscripcion.plan_pendiente_vigente_desde ?? "").slice(0, 7)
      : "";
    const precioActual = Number(suscripcion.precio) || 0;
    const monedaActual = suscripcion.moneda === "USD" ? "USD" : "GS";
    const precioPend = Number(suscripcion.precio_pendiente) || 0;
    const monedaPend = suscripcion.moneda_pendiente === "USD" ? "USD" : "GS";

    const facturacion = meses.map((mes) => {
      const factura = facturasPorMes.get(mes);
      const estadoBase = factura ? "emitida" : "proyectada";
      let badgeEstado = estadoBase;
      if (factura) {
        if (factura.estado === "Pagado" || factura.estado === "Corregida NC" || factura.saldo === 0) {
          badgeEstado = "emitida";
        }
        else if (factura.estado === "Vencido") badgeEstado = "vencida";
        else badgeEstado = "pendiente";
      }
      // Precio del mes: emitido → monto REAL de la factura; proyectado → plan pendiente si ya rige
      // para ese mes, sino el plan actual.
      const aplicaPend = vigDesdeMes !== "" && mes >= vigDesdeMes;
      const precioMes = factura
        ? (factura.monto || (aplicaPend ? precioPend : precioActual))
        : (aplicaPend ? precioPend : precioActual);
      const monedaMes = factura ? monedaActual : (aplicaPend ? monedaPend : monedaActual);
      return {
        mes,
        estado: estadoBase,
        badge_estado: badgeEstado,
        factura_id: factura?.id ?? null,
        precio: precioMes,
        moneda: monedaMes,
      };
    });

    return NextResponse.json(
      successResponse({
        facturacion,
        suscripcion: {
          id: suscripcion.id,
          precio: suscripcion.precio,
          moneda: suscripcion.moneda,
          fecha_inicio: suscripcion.fecha_inicio,
          duracion_meses: suscripcion.duracion_meses,
          // Cambio de plan programado (para mostrar aviso en la UI). null si no hay.
          plan_pendiente_desde: suscripcion.plan_pendiente_id ? (suscripcion.plan_pendiente_vigente_desde ?? null) : null,
          precio_pendiente: suscripcion.plan_pendiente_id ? precioPend : null,
        },
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
