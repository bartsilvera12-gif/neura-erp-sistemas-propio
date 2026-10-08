/**
 * POST /api/chat/contactos/vincular-alias
 *
 * Vincula un contacto como alias permanente de otro. Útil cuando dos filas de
 * chat_contacts corresponden a la misma persona (típico: @lid de WhatsApp +
 * teléfono real del mismo cliente). El alias no se borra: queda vivo apuntando
 * al real, así los próximos mensajes con ese identificador se enrutan solos.
 *
 * Body: { alias_contact_id: uuid, real_contact_id: uuid }
 * Respuesta: { ok, canales, detalle } o { ok:false, error }.
 */
import { NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(request: Request) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase: sb, auth } = ctx;
    const empresaId = auth.empresa_id;

    const body = (await request.json().catch(() => null)) as
      | { alias_contact_id?: unknown; real_contact_id?: unknown }
      | null;
    const aliasId = typeof body?.alias_contact_id === "string" ? body.alias_contact_id.trim() : "";
    const realId = typeof body?.real_contact_id === "string" ? body.real_contact_id.trim() : "";

    if (!UUID.test(aliasId) || !UUID.test(realId)) {
      return NextResponse.json(errorResponse("alias_contact_id y real_contact_id deben ser UUIDs"), { status: 400 });
    }
    if (aliasId === realId) {
      return NextResponse.json(errorResponse("No se puede vincular un contacto a sí mismo"), { status: 400 });
    }

    // Validar que ambos existan y sean de la empresa del usuario (defensa en profundidad —
    // la función SQL ya chequea empresa_id matching, pero fallamos temprano con un error legible).
    const { data: contactos } = await sb
      .from("chat_contacts")
      .select("id, empresa_id, name, phone_number")
      .in("id", [aliasId, realId]);
    const list = (contactos ?? []) as Array<{ id: string; empresa_id: string; name: string | null; phone_number: string }>;
    if (list.length !== 2) {
      return NextResponse.json(errorResponse("Uno de los contactos no existe"), { status: 404 });
    }
    for (const c of list) {
      if (c.empresa_id !== empresaId) {
        return NextResponse.json(errorResponse("Contactos de empresas distintas"), { status: 403 });
      }
    }

    // RPC pública: `neura.vincular_contacto_como_alias` ya hace todo el merge
    // de historial + marca el alias. Idempotente. Nunca lanza — devuelve jsonb.
    const sbTyped = sb as unknown as {
      schema: (s: string) => { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };
    };
    const { data: result, error: rpcErr } = await sbTyped.schema("neura").rpc("vincular_contacto_como_alias", {
      p_alias_id: aliasId,
      p_real_id: realId,
    });
    if (rpcErr) {
      return NextResponse.json(errorResponse(`Error en el vínculo: ${rpcErr.message}`), { status: 500 });
    }

    const payload = result as { ok?: boolean; error?: string } | null;
    if (!payload || payload.ok !== true) {
      return NextResponse.json(errorResponse(payload?.error || "No se pudo vincular"), { status: 400 });
    }

    return NextResponse.json(successResponse(payload));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(errorResponse(`Error interno: ${msg}`), { status: 500 });
  }
}
