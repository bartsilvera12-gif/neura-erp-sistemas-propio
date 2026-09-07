import { NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { requireChatInterno, respuestaAuth } from "@/lib/chat-interno/core";

export const runtime = "nodejs";

/** GET — con quién se puede hablar: los usuarios activos de la empresa. */
export async function GET(request: Request) {
  const auth = await requireChatInterno(request);
  if (!auth.ok) return respuestaAuth(auth);

  try {
    const catalog = createServiceRoleClient();
    const { data } = await catalog
      .from("usuarios")
      .select("id, nombre, area")
      .eq("empresa_id", auth.empresaId)
      .eq("estado", "activo")
      .order("nombre");
    const usuarios = ((data ?? []) as { id: string; nombre: string | null; area: string | null }[])
      .filter((u) => u.id !== auth.usuarioId)
      .map((u) => ({ id: u.id, nombre: u.nombre ?? "—", area: u.area ?? "" }));
    return NextResponse.json(successResponse({ usuarios }));
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error"), { status: 500 });
  }
}
