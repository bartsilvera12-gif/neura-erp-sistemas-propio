import { NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { clienteDelContacto } from "@/lib/clientes/cliente-de-contacto";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * POST /api/chat/contactos/vincular-cliente { conversation_id }
 *
 * Al abrir un chat cuyo contacto no está asociado a un cliente, busca el
 * cliente por teléfono (ficha o contactos secundarios) y, si hay uno solo, deja
 * el contacto vinculado. Por nombre sólo se sugiere (dos personas pueden
 * llamarse igual): se devuelve para mostrar el botón, pero no se guarda.
 *
 * Responde `{ cliente_id, vinculado, via }`; `cliente_id` null si no hay.
 */
export async function POST(request: Request) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase: sb, auth } = ctx;
    const empresaId = auth.empresa_id;

    const body = (await request.json().catch(() => null)) as { conversation_id?: unknown } | null;
    const conversationId = typeof body?.conversation_id === "string" ? body.conversation_id.trim() : "";
    if (!UUID.test(conversationId)) {
      return NextResponse.json(errorResponse("conversation_id inválido"), { status: 400 });
    }

    const { data: conv } = await sb
      .from("chat_conversations")
      .select("contact_id")
      .eq("empresa_id", empresaId)
      .eq("id", conversationId)
      .maybeSingle();
    const contactId = (conv as { contact_id?: string | null } | null)?.contact_id;
    if (!contactId) return NextResponse.json(successResponse({ cliente_id: null, vinculado: false }));

    const { data: contacto } = await sb
      .from("chat_contacts")
      .select("id, cliente_id, phone_number, name")
      .eq("empresa_id", empresaId)
      .eq("id", contactId)
      .maybeSingle();
    const c = contacto as { id: string; cliente_id: string | null; phone_number: string | null; name: string | null } | null;
    if (!c) return NextResponse.json(successResponse({ cliente_id: null, vinculado: false }));
    if (c.cliente_id) return NextResponse.json(successResponse({ cliente_id: c.cliente_id, vinculado: true }));

    const hallado = await clienteDelContacto(sb, empresaId, c.phone_number, c.name);
    if (!hallado) return NextResponse.json(successResponse({ cliente_id: null, vinculado: false }));

    let vinculado = false;
    if (hallado.via === "telefono" || hallado.via === "contacto") {
      // Sólo si sigue sin cliente: no se pisa una asociación hecha a mano.
      const { data: upd } = await sb
        .from("chat_contacts")
        .update({ cliente_id: hallado.cliente_id })
        .eq("empresa_id", empresaId)
        .eq("id", c.id)
        .is("cliente_id", null)
        .select("id")
        .maybeSingle();
      vinculado = !!upd;
    }

    return NextResponse.json(
      successResponse({ cliente_id: hallado.cliente_id, vinculado, via: hallado.via })
    );
  } catch (e) {
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "No se pudo vincular el cliente"),
      { status: 500 }
    );
  }
}
