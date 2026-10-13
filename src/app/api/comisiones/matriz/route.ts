import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import {
  puedeConfigurarComisiones,
  requireComisionesModuleAccess,
} from "@/lib/comisiones/comisiones-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } as const;

/**
 * Matriz de comisiones 2D (Revenue × Recurrencia → %). Modelo "sin sueldo base".
 * Config (gate) + celdas. Solo lectura para todos los del módulo; edición solo admin.
 * Drift-safe: si las tablas no existen en el tenant, responde `disponible:false`.
 */

type Config = { activo: boolean; revenue_min: number; recurrencia_min: number };
type Celda = { revenue_desde: number; recurrencia_desde: number; porcentaje: number };

const DEFAULT_CONFIG: Config = { activo: false, revenue_min: 15000000, recurrencia_min: 500000 };

export async function GET(request: Request) {
  const auth = await requireComisionesModuleAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status, headers: NO_STORE });

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    let disponible = true;
    let config: Config = { ...DEFAULT_CONFIG };
    let celdas: Celda[] = [];
    try {
      const { data: cfg } = await sb
        .from("comision_matriz_config")
        .select("activo, revenue_min, recurrencia_min")
        .eq("empresa_id", auth.empresaId)
        .maybeSingle();
      if (cfg) {
        config = {
          activo: Boolean((cfg as Config).activo),
          revenue_min: Number((cfg as Config).revenue_min) || DEFAULT_CONFIG.revenue_min,
          recurrencia_min: Number((cfg as Config).recurrencia_min) || DEFAULT_CONFIG.recurrencia_min,
        };
      }
      const { data: cel } = await sb
        .from("comision_matriz")
        .select("revenue_desde, recurrencia_desde, porcentaje")
        .eq("empresa_id", auth.empresaId)
        .order("revenue_desde", { ascending: true })
        .order("recurrencia_desde", { ascending: true });
      celdas = ((cel ?? []) as Record<string, unknown>[]).map((c) => ({
        revenue_desde: Number(c.revenue_desde) || 0,
        recurrencia_desde: Number(c.recurrencia_desde) || 0,
        porcentaje: Number(c.porcentaje) || 0,
      }));
    } catch {
      disponible = false; // tabla no existe en este tenant (no es neura)
    }

    return NextResponse.json(
      successResponse({ disponible, config, celdas, puedeEditar: puedeConfigurarComisiones(auth.rol) }),
      { headers: NO_STORE }
    );
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error"), { status: 500, headers: NO_STORE });
  }
}

export async function PUT(request: Request) {
  const auth = await requireComisionesModuleAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status, headers: NO_STORE });
  if (!puedeConfigurarComisiones(auth.rol)) {
    return NextResponse.json(errorResponse("No tenés permiso para configurar comisiones."), { status: 403, headers: NO_STORE });
  }

  let body: { config?: Partial<Config>; celdas?: Celda[] };
  try {
    body = (await request.json()) as { config?: Partial<Config>; celdas?: Celda[] };
  } catch {
    return NextResponse.json(errorResponse("Body JSON inválido"), { status: 400, headers: NO_STORE });
  }

  const cfgIn = body.config ?? {};
  const config: Config = {
    activo: cfgIn.activo === true,
    revenue_min: Number(cfgIn.revenue_min) >= 0 ? Number(cfgIn.revenue_min) : DEFAULT_CONFIG.revenue_min,
    recurrencia_min: Number(cfgIn.recurrencia_min) >= 0 ? Number(cfgIn.recurrencia_min) : DEFAULT_CONFIG.recurrencia_min,
  };
  const celdas = Array.isArray(body.celdas) ? body.celdas : [];

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    // Config: update y si no existe, insert.
    const { data: updCfg } = await sb
      .from("comision_matriz_config")
      .update({ activo: config.activo, revenue_min: config.revenue_min, recurrencia_min: config.recurrencia_min })
      .eq("empresa_id", auth.empresaId)
      .select("id");
    if (!updCfg || (updCfg as unknown[]).length === 0) {
      await sb.from("comision_matriz_config").insert({
        empresa_id: auth.empresaId,
        activo: config.activo,
        revenue_min: config.revenue_min,
        recurrencia_min: config.recurrencia_min,
      });
    }

    // Celdas: update del porcentaje por (revenue_desde, recurrencia_desde). Las 66 ya existen (seed).
    for (const c of celdas) {
      const rd = Number(c.revenue_desde);
      const cd = Number(c.recurrencia_desde);
      const pct = Number(c.porcentaje);
      if (!Number.isFinite(rd) || !Number.isFinite(cd) || !Number.isFinite(pct)) continue;
      const { data: upd } = await sb
        .from("comision_matriz")
        .update({ porcentaje: pct })
        .eq("empresa_id", auth.empresaId)
        .eq("revenue_desde", rd)
        .eq("recurrencia_desde", cd)
        .select("id");
      if (!upd || (upd as unknown[]).length === 0) {
        // celda nueva (si cambió la estructura) → insertar
        await sb.from("comision_matriz").insert({
          empresa_id: auth.empresaId,
          revenue_desde: rd,
          recurrencia_desde: cd,
          porcentaje: pct,
        });
      }
    }

    return NextResponse.json(successResponse({ ok: true }), { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error"), { status: 500, headers: NO_STORE });
  }
}
