import { NextRequest, NextResponse } from "next/server";
import { conBearer } from "@/lib/auth/bearer-contexto";
import { extractBearerTokenFromRequest } from "@/lib/auth/get-auth-user-for-api-route";
import { mensajeDeSesion, requireEmpresaTenantServiceRole } from "@/lib/chat/empresa-tenant-service-role";
import {
  horarioDeUsuario,
  limpiarFranjas,
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
  return {
    // Ausente = encendido: una app vieja que no manda el campo no debe apagarle las
    // notificaciones a nadie sin querer.
    notificar: b.notificar !== false,
    activo: b.activo === true,
    franjas: limpiarFranjas(b.franjas),
  };
}

export async function GET(request: NextRequest) {
  return conBearer(extractBearerTokenFromRequest(request), async () => {
    let ctx;
    try {
      ctx = await requireEmpresaTenantServiceRole(request);
    } catch (e) {
      return NextResponse.json({ ok: false, error: mensajeDeSesion(e) }, { status: 401 });
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
    } catch (e) {
      return NextResponse.json({ ok: false, error: mensajeDeSesion(e) }, { status: 401 });
    }
    const horario = limpiar(body);

    // Un horario activo sin ningún día no deja pasar NADA. Nadie quiere eso de verdad, y el
    // que lo hace sin querer se queda incomunicado sin enterarse: se rechaza.
    if (horario.notificar && horario.activo && Object.keys(horario.franjas).length === 0) {
      return NextResponse.json(
        { ok: false, error: "Elegí al menos un día, o apagá el horario." },
        { status: 400 }
      );
    }

    const { error } = await ctx.supabase.from("usuario_horario_notificaciones").upsert(
      {
        usuario_id: ctx.usuario_id,
        empresa_id: ctx.empresa_id,
        notificar: horario.notificar,
        activo: horario.activo,
        franjas: horario.franjas,
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
