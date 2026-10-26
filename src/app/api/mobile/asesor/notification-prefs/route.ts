import { NextRequest, NextResponse } from "next/server";
import { mensajeDeSesion, requireEmpresaTenantServiceRole } from "@/lib/chat/empresa-tenant-service-role";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Preferencias de notificaciones push del asesor (chat / avisos / soporte / proyectos).
 *
 * GET → devuelve las 4 preferencias (true por defecto si no hay fila).
 * PUT → upsert de las que vienen en el body. Validación mínima: solo booleanos.
 *
 * El dispatcher las consulta antes de enviar el push para skippear al usuario con la
 * categoría apagada; el resto del equipo recibe igual.
 */

type Prefs = {
  chat_enabled: boolean;
  avisos_enabled: boolean;
  soporte_enabled: boolean;
  proyectos_enabled: boolean;
};

const DEFAULTS: Prefs = {
  chat_enabled: true,
  avisos_enabled: true,
  soporte_enabled: true,
  proyectos_enabled: true,
};

export async function GET(req: NextRequest) {
  let ctx;
  try {
    ctx = await requireEmpresaTenantServiceRole(req);
  } catch (e) {
    return NextResponse.json({ ok: false, error: mensajeDeSesion(e) }, { status: 401 });
  }
  const { supabase, empresa_id, usuario_id } = ctx;
  const { data } = await supabase
    .from("agente_notification_prefs")
    .select("chat_enabled, avisos_enabled, soporte_enabled, proyectos_enabled")
    .eq("empresa_id", empresa_id)
    .eq("usuario_id", usuario_id)
    .maybeSingle();
  const prefs: Prefs = {
    chat_enabled: (data as Prefs | null)?.chat_enabled ?? DEFAULTS.chat_enabled,
    avisos_enabled: (data as Prefs | null)?.avisos_enabled ?? DEFAULTS.avisos_enabled,
    soporte_enabled: (data as Prefs | null)?.soporte_enabled ?? DEFAULTS.soporte_enabled,
    proyectos_enabled: (data as Prefs | null)?.proyectos_enabled ?? DEFAULTS.proyectos_enabled,
  };
  return NextResponse.json({ ok: true, prefs });
}

export async function PUT(req: NextRequest) {
  let ctx;
  try {
    ctx = await requireEmpresaTenantServiceRole(req);
  } catch (e) {
    return NextResponse.json({ ok: false, error: mensajeDeSesion(e) }, { status: 401 });
  }
  const { supabase, empresa_id, usuario_id } = ctx;
  const body = (await req.json().catch(() => null)) as Partial<Prefs> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "Body inválido" }, { status: 400 });
  }
  const asBool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  // Lee lo que ya hay para preservar las keys no enviadas en este PUT (parcial).
  const { data: curr } = await supabase
    .from("agente_notification_prefs")
    .select("chat_enabled, avisos_enabled, soporte_enabled, proyectos_enabled")
    .eq("empresa_id", empresa_id)
    .eq("usuario_id", usuario_id)
    .maybeSingle();
  const base = (curr as Prefs | null) ?? DEFAULTS;
  const nuevo: Prefs = {
    chat_enabled: asBool(body.chat_enabled, base.chat_enabled),
    avisos_enabled: asBool(body.avisos_enabled, base.avisos_enabled),
    soporte_enabled: asBool(body.soporte_enabled, base.soporte_enabled),
    proyectos_enabled: asBool(body.proyectos_enabled, base.proyectos_enabled),
  };
  const { error } = await supabase
    .from("agente_notification_prefs")
    .upsert(
      { empresa_id, usuario_id, ...nuevo, updated_at: new Date().toISOString() },
      { onConflict: "empresa_id,usuario_id" }
    );
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, prefs: nuevo });
}
