import { NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";

/** Estados de factura que NO son deuda (mismo criterio que Cobranzas). */
const ESTADOS_NO_DEUDA = new Set(["pagado", "anulado", "corregida nc"]);

/**
 * Facturas pendientes de un cliente, para asociar una a un proyecto al crearlo
 * (o desde su ficha). "Pendiente" = tiene saldo por cobrar y no está anulada.
 * Se devuelve el saldo (lo realmente adeudado), que es lo que después muestra la
 * columna Deuda del tablero.
 */
export async function GET(request: Request) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  const url = new URL(request.url);
  const clienteId = (url.searchParams.get("cliente_id") ?? "").trim();
  if (!clienteId) {
    return NextResponse.json(successResponse([]));
  }

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const { data, error } = await sb
      .from("facturas")
      .select("id, numero_factura, fecha, monto, saldo, estado, tipo")
      .eq("empresa_id", auth.empresaId)
      .eq("cliente_id", clienteId)
      .order("fecha", { ascending: false })
      .limit(200);

    if (error) {
      // Tenant sin tabla facturas o columna distinta: lista vacía, no rompe el alta.
      return NextResponse.json(successResponse([]));
    }

    const pendientes = (data ?? [])
      .filter((f) => {
        const estado = String((f as { estado?: unknown }).estado ?? "").trim().toLowerCase();
        if (ESTADOS_NO_DEUDA.has(estado)) return false;
        const saldo = Number((f as { saldo?: unknown }).saldo ?? 0);
        return Number.isFinite(saldo) && saldo > 0;
      })
      .map((f) => {
        const row = f as Record<string, unknown>;
        return {
          id: String(row.id),
          numero_factura: String(row.numero_factura ?? ""),
          fecha: typeof row.fecha === "string" ? row.fecha : null,
          monto: Number(row.monto ?? 0),
          saldo: Number(row.saldo ?? 0),
          estado: String(row.estado ?? ""),
          tipo: String(row.tipo ?? ""),
        };
      });

    return NextResponse.json(successResponse(pendientes));
  } catch {
    return NextResponse.json(successResponse([]));
  }
}
