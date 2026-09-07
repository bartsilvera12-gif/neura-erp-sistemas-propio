import { NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import {
  CHAT_ARCHIVO_MAX_BYTES,
  CHAT_BUCKET,
  chatAdjuntoPath,
  claseDeAdjunto,
  ensureChatBucket,
  esMiembro,
  requireChatInterno,
  respuestaAuth,
} from "@/lib/chat-interno/core";

export const runtime = "nodejs";

/**
 * POST — sube un archivo o un audio y devuelve su referencia.
 *
 * El archivo viaja primero y el mensaje después guarda la referencia: así un
 * mensaje nunca queda apuntando a algo que no se subió.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireChatInterno(request);
  if (!auth.ok) return respuestaAuth(auth);
  const { sb, empresaId, usuarioId } = auth;
  const { id: salaId } = await params;

  try {
    const { miembro } = await esMiembro(sb, salaId, usuarioId);
    if (!miembro) return NextResponse.json(errorResponse("No sos miembro de esta sala"), { status: 403 });

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(errorResponse("Archivo vacío"), { status: 400 });
    }
    if (file.size > CHAT_ARCHIVO_MAX_BYTES) {
      return NextResponse.json(errorResponse("El archivo supera los 25 MB"), { status: 400 });
    }

    await ensureChatBucket(sb);
    const nombre = file.name || "archivo";
    const path = chatAdjuntoPath(empresaId, salaId, nombre);
    const { error } = await sb.storage
      .from(CHAT_BUCKET)
      .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    return NextResponse.json(
      successResponse({
        path,
        nombre,
        mime_type: file.type || "application/octet-stream",
        size_bytes: file.size,
        clase: claseDeAdjunto(file.type || ""),
      }),
      { status: 201 }
    );
  } catch (e) {
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "No se pudo subir"),
      { status: 500 }
    );
  }
}
