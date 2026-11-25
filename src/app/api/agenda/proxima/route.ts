import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireNotificacionesAccess } from "@/lib/notificaciones/notificaciones-auth";
import { proximaReunionDe } from "@/lib/agenda/proxima-reunion";

export const runtime = "nodejs";

/**
 * GET /api/agenda/proxima — mi reunión en curso o la próxima de hoy, para el aviso de
 * la barra de arriba. El usuario sale de la sesión, nunca de la query.
 */
export async function GET(request: Request) {
  const auth = await requireNotificacionesAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const reunion = await proximaReunionDe(sb, auth.empresaId, auth.usuarioId);
    return NextResponse.json(successResponse({ reunion }));
  } catch {
    // El header no puede romperse por la agenda: sin aviso es aceptable.
    return NextResponse.json(successResponse({ reunion: null }));
  }
}
