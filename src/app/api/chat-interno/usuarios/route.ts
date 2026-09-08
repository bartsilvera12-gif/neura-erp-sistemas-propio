import { NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { firmarAvatares, requireChatInterno, respuestaAuth } from "@/lib/chat-interno/core";

export const runtime = "nodejs";

/** GET — con quién se puede hablar: los usuarios activos de la empresa. */
export async function GET(request: Request) {
  const auth = await requireChatInterno(request);
  if (!auth.ok) return respuestaAuth(auth);

  try {
    const catalog = createServiceRoleClient();
    const { data } = await catalog
      .from("usuarios")
      .select("id, nombre, area, avatar_path")
      .eq("empresa_id", auth.empresaId)
      .eq("estado", "activo")
      .order("nombre");
    const filas = ((data ?? []) as {
      id: string;
      nombre: string | null;
      area: string | null;
      avatar_path: string | null;
    }[]).filter((u) => u.id !== auth.usuarioId);
    const avatares = await firmarAvatares(auth.sb, filas);
    const usuarios = filas.map((u) => ({
      id: u.id,
      nombre: u.nombre ?? "—",
      area: u.area ?? "",
      avatar_url: avatares.get(u.id) ?? null,
    }));
    return NextResponse.json(successResponse({ usuarios }));
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error"), { status: 500 });
  }
}
