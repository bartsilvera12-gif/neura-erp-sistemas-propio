import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireNotificacionesAccess } from "@/lib/notificaciones/notificaciones-auth";

/**
 * POST /api/notificaciones/marcar-leidas
 *
 * Tres formas de marcar, todas acotadas al usuario de la sesión:
 *   { ids: [...] }          una o varias puntuales (click en el panel)
 *   { proyecto_id: "..." }  las de ese proyecto (al abrir el detalle: es lo
 *                           que apaga el badge de la lista para ese usuario)
 *   { todas: true }         limpiar el panel entero
 *
 * Whitelist explícita, sin spread del body: lo único que se escribe es
 * `leida_at`, y el `usuario_id` del WHERE sale de la sesión.
 */
export async function POST(request: Request) {
  const auth = await requireNotificacionesAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json(errorResponse("Body inválido"), { status: 400 });
    }

    const ids = Array.isArray(body.ids)
      ? body.ids.filter((v): v is string => typeof v === "string" && v.length > 0)
      : [];
    const proyectoId =
      typeof body.proyecto_id === "string" && body.proyecto_id.trim()
        ? body.proyecto_id.trim()
        : null;
    const todas = body.todas === true;

    if (ids.length === 0 && !proyectoId && !todas) {
      return NextResponse.json(
        errorResponse("Indicá `ids`, `proyecto_id` o `todas`"),
        { status: 400 }
      );
    }

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    let q = sb
      .from("usuario_notificaciones")
      .update({ leida_at: new Date().toISOString() })
      .eq("empresa_id", auth.empresaId)
      .eq("usuario_id", auth.usuarioId)
      .is("leida_at", null);

    if (ids.length > 0) q = q.in("id", ids);
    else if (proyectoId) q = q.eq("proyecto_id", proyectoId);

    const { data, error } = await q.select("id");
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    return NextResponse.json(successResponse({ marcadas: (data ?? []).length }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
