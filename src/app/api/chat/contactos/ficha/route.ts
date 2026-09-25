import { NextRequest, NextResponse } from "next/server";
import { conBearer } from "@/lib/auth/bearer-contexto";
import { extractBearerTokenFromRequest } from "@/lib/auth/get-auth-user-for-api-route";
import { requireEmpresaTenantServiceRole } from "@/lib/chat/empresa-tenant-service-role";
import { construirFichaContacto } from "@/lib/chat/ficha-contacto";

export const runtime = "nodejs";

/**
 * GET /api/chat/contactos/ficha?conversation_id=<uuid>
 *
 * Ficha lateral del contacto del chat: cliente, proyectos, tipificación y recorrido.
 *
 * Se entra por conversación y no por contacto porque la autorización del omnicanal es por
 * conversación: así el permiso se valida contra algo que el usuario ya está viendo, en vez de
 * tener que inventar una regla nueva para el contacto suelto.
 *
 * Acepta `Authorization: Bearer` además de cookies, para que la app nativa pueda usar la
 * misma ruta cuando le toque.
 */
export async function GET(request: NextRequest) {
  return conBearer(extractBearerTokenFromRequest(request), () => manejar(request));
}

async function manejar(request: NextRequest) {
  const conversationId = (new URL(request.url).searchParams.get("conversation_id") ?? "").trim();
  if (!conversationId) {
    return NextResponse.json({ ok: false, error: "Falta conversation_id" }, { status: 400 });
  }

  let ctx;
  try {
    ctx = await requireEmpresaTenantServiceRole(request);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Iniciá sesión", code: "unauthenticated" },
      { status: 401 }
    );
  }

  try {
    const r = await construirFichaContacto({
      supabase: ctx.supabase,
      catalogSr: ctx.catalogSr,
      empresaId: ctx.empresa_id,
      usuarioId: ctx.usuario_id,
      conversationId,
      request,
    });
    if (!r.ok) {
      return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
    }
    return NextResponse.json({ ok: true, ficha: r.ficha });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ficha-contacto]", msg);
    return NextResponse.json({ ok: false, error: "No se pudo armar la ficha" }, { status: 500 });
  }
}
