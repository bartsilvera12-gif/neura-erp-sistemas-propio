import { NextRequest, NextResponse } from "next/server";
import { getAuthWithRol } from "@/lib/middleware/auth";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LOG = "[api/chat/conversations/start]";

/**
 * POST /api/chat/conversations/start
 * Inicia (o reabre) una conversación con una persona desde el ERP, para el botón
 * "Nuevo mensaje". Crea el contacto si no existe, crea la conversación en modo HUMANO
 * (sin bot) y la asigna al asesor que la inicia. Devuelve conversation_id para que el
 * inbox la abra y el envío siga por el flujo normal (/api/chat/send).
 *
 * Body: { channelId, phone, name? }
 */

/** Normaliza un número a solo dígitos con código de país (asume Paraguay si es local). */
function normalizarNumero(raw: string): string {
  let d = String(raw || "").replace(/\D+/g, "");
  if (!d) return "";
  d = d.replace(/^0+/, ""); // 0981... → 981...
  // Paraguay local (9 dígitos empezando en 9, ej. 981234567) → prefijo país 595.
  if (d.length === 9 && d.startsWith("9")) d = "595" + d;
  return d;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthWithRol(request);
    if (!auth?.empresa_id) {
      return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as {
      channelId?: string;
      phone?: string;
      name?: string;
    } | null;

    const channelId = String(body?.channelId ?? "").trim();
    const phone = normalizarNumero(String(body?.phone ?? ""));
    const name = String(body?.name ?? "").trim() || null;

    if (!channelId) {
      return NextResponse.json({ ok: false, error: "Elegí un canal." }, { status: 400 });
    }
    if (!phone || phone.length < 8 || phone.length > 15) {
      return NextResponse.json(
        { ok: false, error: "Número inválido. Ingresalo con código de país, ej. 595981234567." },
        { status: 400 }
      );
    }

    const supabase = await getChatServiceClientForEmpresa(auth.empresa_id);

    // Canal válido, de esta empresa, activo y de WhatsApp.
    const { data: chRow, error: chErr } = await supabase
      .from("chat_channels")
      .select("id, empresa_id, type, activo")
      .eq("id", channelId)
      .maybeSingle();
    if (chErr) throw new Error(chErr.message);
    const ch = chRow as { empresa_id?: string; type?: string | null; activo?: boolean | null } | null;
    if (!ch || String(ch.empresa_id ?? "") !== auth.empresa_id) {
      return NextResponse.json({ ok: false, error: "Canal no encontrado." }, { status: 404 });
    }
    if (ch.activo === false) {
      return NextResponse.json({ ok: false, error: "El canal está inactivo." }, { status: 409 });
    }
    if (String(ch.type ?? "whatsapp") !== "whatsapp") {
      return NextResponse.json({ ok: false, error: "El canal no es de WhatsApp." }, { status: 400 });
    }

    // Contacto: crear si no existe (sin pisar el nombre si ya tenía uno y no mandan otro).
    const upsertPayload: Record<string, unknown> = {
      empresa_id: auth.empresa_id,
      phone_number: phone,
      phone_normalized: phone,
    };
    if (name) upsertPayload.name = name;
    const { data: contactRow, error: cErr } = await supabase
      .from("chat_contacts")
      .upsert(upsertPayload, { onConflict: "empresa_id,phone_number" })
      .select("id")
      .single();
    if (cErr || !contactRow) {
      return NextResponse.json({ ok: false, error: `Contacto: ${cErr?.message ?? "error"}` }, { status: 500 });
    }
    const contactId = String((contactRow as { id: string }).id);

    // Agente del asesor que inicia (para asignarle la conversación). Best-effort.
    let agentId: string | null = null;
    if (auth.usuarioCatalogId) {
      try {
        const ag = await supabase
          .from("chat_agents")
          .select("id")
          .eq("empresa_id", auth.empresa_id)
          .eq("usuario_id", auth.usuarioCatalogId)
          .limit(1);
        agentId = ((ag.data as { id: string }[] | null) ?? [])[0]?.id ?? null;
      } catch {
        /* sin agente → queda sin asignar */
      }
    }

    // Conversación: reusar la que ya exista (contacto+canal) o crear una nueva en modo HUMANO.
    const { data: existingRow } = await supabase
      .from("chat_conversations")
      .select("id, status")
      .eq("contact_id", contactId)
      .eq("channel_id", channelId)
      .maybeSingle();
    const existing = existingRow as { id?: string; status?: string } | null;

    let conversationId: string;
    let created = false;
    if (existing?.id) {
      conversationId = String(existing.id);
      // Reabrir si estaba cerrada + tomar como humano + (re)asignar al creador.
      const patch: Record<string, unknown> = { status: "open", human_taken_over: true };
      if (agentId) patch.assigned_agent_id = agentId;
      await supabase.from("chat_conversations").update(patch).eq("id", conversationId);
    } else {
      const insertPayload: Record<string, unknown> = {
        empresa_id: auth.empresa_id,
        channel_id: channelId,
        contact_id: contactId,
        status: "open",
        flow_code: null,
        flow_current_node: null,
        flow_status: "human",
        human_taken_over: true,
        last_message_at: null,
        last_message_preview: null,
        unread_count: 0,
      };
      if (agentId) insertPayload.assigned_agent_id = agentId;
      const { data: convRow, error: convErr } = await supabase
        .from("chat_conversations")
        .insert(insertPayload)
        .select("id")
        .single();
      if (convErr?.code === "23505") {
        // Carrera: otro proceso la creó. Reusar.
        const { data: again } = await supabase
          .from("chat_conversations")
          .select("id")
          .eq("contact_id", contactId)
          .eq("channel_id", channelId)
          .maybeSingle();
        conversationId = String((again as { id?: string } | null)?.id ?? "");
        if (!conversationId) {
          return NextResponse.json({ ok: false, error: "No se pudo crear la conversación." }, { status: 500 });
        }
      } else if (convErr || !convRow) {
        return NextResponse.json({ ok: false, error: `Conversación: ${convErr?.message ?? "error"}` }, { status: 500 });
      } else {
        conversationId = String((convRow as { id: string }).id);
        created = true;
      }
    }

    console.info(LOG, "ok", { conversationId, created, assigned: Boolean(agentId) });
    return NextResponse.json({ ok: true, conversation_id: conversationId, contact_id: contactId, created });
  } catch (e) {
    console.error(LOG, "error", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
