import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { requireCobranzasModuleAccess } from "@/lib/cobranzas/cobranzas-auth";
import { hoyAsuncionYmd } from "@/lib/cobranzas/cobranzas-data";
import { errorResponse, successResponse } from "@/lib/api/response";

/**
 * POST — marca/desmarca "cobranza enviada" de un cliente para el MES EN CURSO.
 * Cualquier usuario con acceso al módulo Cobranzas (no requiere admin), igual que
 * la promesa de pago. La marca es por cliente + período (YYYY-MM): se resetea sola
 * cada mes porque la lista solo consulta el mes actual.
 *
 * Body: { cliente_id: string, enviada: boolean }
 *  - enviada true  → inserta la marca del período (idempotente)
 *  - enviada false → borra la marca del período
 */
export async function POST(request: Request) {
  const auth = await requireCobranzasModuleAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

  let body: { cliente_id?: unknown; enviada?: unknown };
  try {
    body = (await request.json()) as { cliente_id?: unknown; enviada?: unknown };
  } catch {
    return NextResponse.json(errorResponse("Body JSON inválido"), { status: 400 });
  }
  const clienteId = typeof body.cliente_id === "string" ? body.cliente_id.trim() : "";
  const enviada = body.enviada === true;
  if (!clienteId) return NextResponse.json(errorResponse("cliente_id requerido"), { status: 400 });

  const periodo = hoyAsuncionYmd(new Date()).slice(0, 7); // YYYY-MM

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    if (!enviada) {
      const { error } = await sb
        .from("cobranza_envios")
        .delete()
        .eq("empresa_id", auth.empresaId)
        .eq("cliente_id", clienteId)
        .eq("periodo", periodo);
      if (error) throw new Error(error.message);
      return NextResponse.json(successResponse({ ok: true, cliente_id: clienteId, periodo, enviada: false }));
    }

    let email: string | null = null;
    try {
      const { data } = await sb.from("usuarios").select("email").eq("id", auth.usuarioCatalogId).maybeSingle();
      const e = (data as { email?: string } | null)?.email;
      email = typeof e === "string" && e.trim() ? e.trim() : null;
    } catch {
      /* email opcional */
    }

    const { error } = await sb.from("cobranza_envios").insert({
      empresa_id: auth.empresaId,
      cliente_id: clienteId,
      periodo,
      marcado_por: auth.usuarioCatalogId,
      marcado_por_email: email,
    });
    // Ya estaba marcado (unique empresa_id+cliente_id+periodo): es idempotente, no es error.
    if (error && !/duplicate key|23505/i.test(error.message)) throw new Error(error.message);

    return NextResponse.json(successResponse({ ok: true, cliente_id: clienteId, periodo, enviada: true }));
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error"), { status: 500 });
  }
}
