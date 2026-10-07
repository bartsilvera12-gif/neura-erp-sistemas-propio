import { NextRequest, NextResponse } from "next/server";
import { conBearer } from "@/lib/auth/bearer-contexto";
import { extractBearerTokenFromRequest } from "@/lib/auth/get-auth-user-for-api-route";
import { requireEmpresaTenantServiceRole } from "@/lib/chat/empresa-tenant-service-role";
import { filterConversationIdsByOmnicanalScope } from "@/lib/chat/omnicanal-scope";
import { nombreClienteDisplay } from "@/lib/clientes/display-name";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

export const runtime = "nodejs";

/**
 * Vincular el contacto de un chat con un cliente, a mano.
 *
 * El ERP ya deduce el cliente por teléfono o por nombre y, cuando acierta, lo deja guardado.
 * El problema es cuando se equivoca —o cuando el dato de origen está mal cargado—: la
 * deducción queda escrita como si fuera un hecho y no había forma de corregirla desde ninguna
 * pantalla. Pasó con un contacto que figuraba bajo otro cliente porque su número estaba en el
 * teléfono secundario de ese cliente.
 *
 * GET  ?q=texto            → clientes que coinciden, para elegir
 * POST { conversation_id, cliente_id }        → vincula
 * POST { conversation_id, cliente_id: null }  → desvincula
 *
 * Permiso: el mismo alcance omnicanal que la ficha. Si podés ver el chat, podés corregir a
 * quién apunta su contacto.
 */
export async function GET(request: NextRequest) {
  return conBearer(extractBearerTokenFromRequest(request), async () => {
    const q = (request.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
    if (q.length < 2) return NextResponse.json({ ok: true, clientes: [] });

    let ctx;
    try {
      ctx = await requireEmpresaTenantServiceRole(request);
    } catch {
      return NextResponse.json({ ok: false, error: "Iniciá sesión" }, { status: 401 });
    }

    const { data } = await ctx.supabase
      .from("clientes")
      .select("id, tipo_cliente, nombre, empresa, razon_social, nombre_contacto, ruc, telefono")
      .eq("empresa_id", ctx.empresa_id)
      .is("deleted_at", null)
      .limit(2000);

    const filas = (data ?? []) as Record<string, unknown>[];
    const texto = (v: unknown) => String(v ?? "").toLowerCase();
    const clientes = filas
      .filter(
        (c) =>
          texto(c.empresa).includes(q) ||
          texto(c.nombre).includes(q) ||
          texto(c.nombre_contacto).includes(q) ||
          texto(c.razon_social).includes(q) ||
          texto(c.ruc).includes(q) ||
          texto(c.telefono).replace(/\D/g, "").includes(q.replace(/\D/g, "") || "\0")
      )
      .slice(0, 25)
      .map((c) => ({
        id: String(c.id),
        nombre: nombreClienteDisplay(c),
        ruc: String(c.ruc ?? "").trim() || null,
        telefono: String(c.telefono ?? "").trim() || null,
      }));

    return NextResponse.json({ ok: true, clientes });
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | { conversation_id?: string; cliente_id?: string | null }
    | null;
  const conversationId = (body?.conversation_id ?? "").trim();
  // `null` explícito = desvincular. No es lo mismo que no mandar el campo.
  const clienteId = body?.cliente_id === null ? null : (body?.cliente_id ?? "").trim();
  if (!conversationId) {
    return NextResponse.json({ ok: false, error: "Falta conversation_id" }, { status: 400 });
  }

  return conBearer(extractBearerTokenFromRequest(request), async () => {
    let ctx;
    try {
      ctx = await requireEmpresaTenantServiceRole(request);
    } catch {
      return NextResponse.json({ ok: false, error: "Iniciá sesión" }, { status: 401 });
    }
    const { supabase, catalogSr, empresa_id, usuario_id } = ctx;

    const contactId = await contactoDeConversacionVisible(
      supabase,
      catalogSr,
      empresa_id,
      usuario_id,
      conversationId
    );
    if (!contactId) {
      return NextResponse.json(
        { ok: false, error: "No autorizado para esta conversación" },
        { status: 403 }
      );
    }

    if (clienteId) {
      const { data: existe } = await supabase
        .from("clientes")
        .select("id")
        .eq("empresa_id", empresa_id)
        .eq("id", clienteId)
        .maybeSingle();
      if (!existe) {
        return NextResponse.json({ ok: false, error: "Cliente no encontrado" }, { status: 404 });
      }
    }

    const { error } = await supabase
      .from("chat_contacts")
      .update({ cliente_id: clienteId || null })
      .eq("empresa_id", empresa_id)
      .eq("id", contactId);
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  });
}

/** El contacto del chat, sólo si el usuario puede ver esa conversación. */
async function contactoDeConversacionVisible(
  supabase: AppSupabaseClient,
  catalogSr: AppSupabaseClient,
  empresaId: string,
  usuarioId: string,
  conversationId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("chat_conversations")
    .select("contact_id")
    .eq("empresa_id", empresaId)
    .eq("id", conversationId)
    .maybeSingle();
  const contactId = String((data as { contact_id?: string | null } | null)?.contact_id ?? "").trim();
  if (!contactId) return null;

  const visibles = await filterConversationIdsByOmnicanalScope(
    supabase,
    catalogSr,
    empresaId,
    usuarioId,
    [conversationId]
  );
  return visibles.has(conversationId) ? contactId : null;
}
