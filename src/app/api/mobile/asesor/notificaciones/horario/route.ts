import { NextRequest, NextResponse } from "next/server";
import { conBearer } from "@/lib/auth/bearer-contexto";
import { extractBearerTokenFromRequest } from "@/lib/auth/get-auth-user-for-api-route";
import { requireEmpresaTenantServiceRole } from "@/lib/chat/empresa-tenant-service-role";
import {
  horarioDeUsuario,
  HORARIO_POR_DEFECTO,
  type HorarioNotificaciones,
} from "@/lib/cc/horario-notificaciones";
import type { SupabaseAdmin } from "@/lib/chat/types";

export const runtime = "nodejs";

/**
 * Horario propio de notificaciones push.
 *
 * GET  → el horario guardado, o los valores por defecto si todavía no configuró nada.
 * PUT  → lo guarda. Cada uno el suyo: siempre se escribe sobre el usuario logueado, nunca
 *        sobre otro, así que no hace falta chequear permisos de supervisión.
 */

function limpiar(body: unknown): HorarioNotificaciones {
  const b = (body ?? {}) as Record<string, unknown>;
  const dias = Array.isArray(b.dias)
    ? [...new Set((b.dias as unknown[]).map((d) => Number(d)).filter((d) => d >= 0 && d <= 6))].sort()
    : HORARIO_POR_DEFECTO.dias;
  const hora = (v: unknown, porDefecto: number) => {
    const n = Math.trunc(Number(v));
    return Number.isFinite(n) && n >= 0 && n <= 23 ? n : porDefecto;
  };
  return {
    activo: b.activo === true,
    dias,
    hora_desde: hora(b.hora_desde, HORARIO_POR_DEFECTO.hora_desde),
    hora_hasta: hora(b.hora_hasta, HORARIO_POR_DEFECTO.hora_hasta),
  };
}

export async function GET(request: NextRequest) {
  return conBearer(extractBearerTokenFromRequest(request), async () => {
    let ctx;
    try {
      ctx = await requireEmpresaTenantServiceRole(request);
    } catch {
      return NextResponse.json({ ok: false, error: "Iniciá sesión" }, { status: 401 });
    }
    const horario = await horarioDeUsuario(ctx.supabase as unknown as SupabaseAdmin, ctx.usuario_id);
    return NextResponse.json({ ok: true, horario: horario ?? HORARIO_POR_DEFECTO });
  });
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null);
  return conBearer(extractBearerTokenFromRequest(request), async () => {
    let ctx;
    try {
      ctx = await requireEmpresaTenantServiceRole(request);
    } catch {
      return NextResponse.json({ ok: false, error: "Iniciá sesión" }, { status: 401 });
    }
    const horario = limpiar(body);

    // Un horario activo sin días no deja pasar NADA: eso no es lo que nadie quiere, así que
    // se guarda desactivado en vez de dejar a la persona incomunicada sin darse cuenta.
    if (horario.activo && horario.dias.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Elegí al menos un día, o apagá el horario." },
        { status: 400 }
      );
    }

    const { error } = await ctx.supabase.from("usuario_horario_notificaciones").upsert(
      {
        usuario_id: ctx.usuario_id,
        empresa_id: ctx.empresa_id,
        activo: horario.activo,
        dias: horario.dias,
        hora_desde: horario.hora_desde,
        hora_hasta: horario.hora_hasta,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "usuario_id" }
    );
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, horario });
  });
}
