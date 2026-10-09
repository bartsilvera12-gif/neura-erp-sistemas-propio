/**
 * Equivalencias "código interno (@lid) → teléfono real" que manda el puente.
 *
 * Por qué existe aparte del webhook de mensajes: la corrección que va ahí solo ocurre cuando
 * el contacto ESCRIBE, y además solo si ese mensaje en particular trae el teléfono. Los chats
 * que ya estaban en el inbox con el código interno se quedaban así, a la vista, hasta que la
 * persona volviera a escribir — y los que WhatsApp nunca acompaña con el teléfono, para siempre.
 *
 * WhatsApp, por su cuenta, manda la libreta de contactos con las dos caras de cada uno (el @lid
 * y el número). El puente escucha eso y lo reenvía acá, así los números se arreglan solos.
 *
 * Seguridad: mismo `x-bridge-secret` que el resto del puente.
 *
 * POST { empresaId, pares: [{ lid: "219537454674033", telefono: "595971234567" }] }
 */
import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { guardarTelefonoRealDelContacto } from "@/lib/chat/baileys-telefono-real";
import { normalizeWaPhone } from "@/lib/chat/wa-phone";
import type { SupabaseAdmin } from "@/lib/chat/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LOG = "[webhooks/baileys/inbound/telefonos]";

/** Tope por llamada: la libreta entera puede ser enorme y el puente la manda de a tandas. */
const MAX_PARES = 500;

export async function POST(request: NextRequest) {
  const secret = (process.env.BAILEYS_BRIDGE_SECRET || "").trim();
  if (!secret) {
    console.error(LOG, "BAILEYS_BRIDGE_SECRET no configurado en el servidor");
    return NextResponse.json({ ok: false, error: "bridge_secret_not_configured" }, { status: 500 });
  }
  if ((request.headers.get("x-bridge-secret") || "").trim() !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    empresaId?: string;
    pares?: { lid?: string; telefono?: string }[];
  } | null;

  const empresaId = String(body?.empresaId ?? "").trim();
  const pares = Array.isArray(body?.pares) ? body!.pares!.slice(0, MAX_PARES) : [];
  if (!empresaId || pares.length === 0) {
    return NextResponse.json({ ok: false, error: "faltan campos: empresaId, pares" }, { status: 400 });
  }

  try {
    const supabase = (await getChatServiceClientForEmpresa(empresaId)) as unknown as SupabaseAdmin;

    // Solo interesan los que de verdad cambian algo.
    const limpios = pares
      .map((p) => ({
        lid: normalizeWaPhone(String(p?.lid ?? "")),
        telefono: normalizeWaPhone(String(p?.telefono ?? "")),
      }))
      .filter((p) => p.lid && p.telefono && p.lid !== p.telefono);
    if (limpios.length === 0) return NextResponse.json({ ok: true, corregidos: 0 });

    // Se buscan de una sola vez: uno por uno serían cientos de consultas.
    const { data: filas, error } = await supabase
      .from("chat_contacts")
      .select("id, phone_number")
      .eq("empresa_id", empresaId)
      .in("phone_number", limpios.map((p) => p.lid));
    if (error) throw new Error(error.message);

    const porLid = new Map<string, string>();
    for (const f of (filas ?? []) as { id: string; phone_number: string }[]) {
      porLid.set(String(f.phone_number), String(f.id));
    }

    // Guarda el teléfono real en `telefono_real` (NO renombra phone_number, NO fusiona): solo
    // para MOSTRAR. Sincroniza las equivalencias de la libreta que el puente ya manda, sin
    // esperar mensajes nuevos ni partir conversaciones.
    let corregidos = 0;
    for (const p of limpios) {
      if (!porLid.get(p.lid)) continue; // solo los @lid que existen como contacto
      if (await guardarTelefonoRealDelContacto(supabase, empresaId, p.lid, p.telefono)) {
        corregidos++;
      }
    }

    if (corregidos > 0) console.info(LOG, "numeros_corregidos", { corregidos, recibidos: limpios.length });
    return NextResponse.json({ ok: true, corregidos, recibidos: limpios.length });
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    console.error(LOG, "error", detalle);
    return NextResponse.json({ ok: false, error: detalle }, { status: 500 });
  }
}
