import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import {
  candidatosMencionDe,
  esCanalComentario,
  permisoComentariosDe,
} from "@/lib/proyectos/comentarios-permisos";

/**
 * GET /api/proyectos/{id}/comentarios/menciones?canal=desarrollo
 *
 * A quién se puede mencionar con @ en ese canal. La lista la arma el servidor y
 * no el navegador: quién ve cada canal es una decisión de permisos, y dejarla
 * en el cliente permitiría ofrecer —y notificar— a alguien que no puede abrir
 * el comentario.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

  const { id } = await params;
  const pid = id?.trim() ?? "";
  if (!pid) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

  const canal = new URL(request.url).searchParams.get("canal");
  if (!esCanalComentario(canal)) {
    return NextResponse.json(errorResponse("canal inválido"), { status: 400 });
  }

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    // Quien no ve el canal tampoco puede saber quiénes están en él.
    const permiso = await permisoComentariosDe(sb, auth.empresaId, auth.usuarioCatalogId, pid);
    if (!permiso.canales.includes(canal)) {
      return NextResponse.json(errorResponse("Sin acceso a ese canal"), { status: 403 });
    }

    const candidatos = await candidatosMencionDe(sb, auth.empresaId, pid, canal);
    // Mencionarse a uno mismo no notifica nada útil.
    return NextResponse.json(
      successResponse({ candidatos: candidatos.filter((c) => c.id !== auth.usuarioCatalogId) })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "No se pudo cargar la lista";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
