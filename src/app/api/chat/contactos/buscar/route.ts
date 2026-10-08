/**
 * GET /api/chat/contactos/buscar?q=...&excluir=<uuid>
 *
 * Buscador de contactos para el UI de "Vincular como alias". Busca por nombre
 * (case-insensitive, substring) o por teléfono (dígitos). Devuelve hasta 10 hits.
 * Excluye el propio contacto (vía `excluir`) y los que ya son alias de otro
 * (porque no deberían ser destino de nuevos alias — ver vincular_contacto_como_alias).
 */
import { NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

const UUID = /^[0-9a-f-]{36}$/i;
const LIMIT = 10;

export async function GET(request: Request) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase: sb, auth } = ctx;
    const empresaId = auth.empresa_id;

    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const excluir = (url.searchParams.get("excluir") ?? "").trim();
    if (!q || q.length < 2) return NextResponse.json(successResponse({ contactos: [] }));

    const soloDigitos = q.replace(/\D+/g, "");
    const esNumerico = soloDigitos.length >= 4 && soloDigitos === q.replace(/[\s+()\-]/g, "");

    // Doble filtro: busca por name O por phone_number. `.or()` de PostgREST sirve.
    let query = sb
      .from("chat_contacts")
      .select("id, name, phone_number, alias_de_contact_id")
      .eq("empresa_id", empresaId)
      .is("alias_de_contact_id", null)
      .limit(LIMIT);

    if (esNumerico) {
      query = query.ilike("phone_number", `%${soloDigitos}%`);
    } else {
      query = query.ilike("name", `%${q}%`);
    }
    if (UUID.test(excluir)) query = query.neq("id", excluir);

    const { data, error } = await query;
    if (error) return NextResponse.json(errorResponse(`Búsqueda falló: ${error.message}`), { status: 500 });

    return NextResponse.json(successResponse({ contactos: data ?? [] }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(errorResponse(`Error interno: ${msg}`), { status: 500 });
  }
}
