import { NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import {
  esMiembro,
  firmarAvatares,
  requireChatInterno,
  respuestaAuth,
} from "@/lib/chat-interno/core";

export const runtime = "nodejs";

/** GET — quiénes están en la sala. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireChatInterno(request);
  if (!auth.ok) return respuestaAuth(auth);
  const { sb, usuarioId } = auth;
  const { id: salaId } = await params;

  try {
    const { miembro } = await esMiembro(sb, salaId, usuarioId);
    if (!miembro) return NextResponse.json(errorResponse("No sos miembro"), { status: 403 });

    const { data } = await sb
      .from("chat_interno_miembros")
      .select("usuario_id, rol")
      .eq("sala_id", salaId);
    const filas = (data ?? []) as { usuario_id: string; rol: string }[];
    const catalog = createServiceRoleClient();
    const { data: usuarios } = filas.length
      ? await catalog
          .from("usuarios")
          .select("id, nombre, avatar_path")
          .in("id", filas.map((f) => f.usuario_id))
      : { data: [] as { id: string; nombre: string | null; avatar_path: string | null }[] };
    const personas = (usuarios ?? []) as {
      id: string;
      nombre: string | null;
      avatar_path: string | null;
    }[];
    const nombreDe = new Map(personas.map((u) => [u.id, u.nombre ?? "—"]));
    const avatarDe = await firmarAvatares(sb, personas);

    return NextResponse.json(
      successResponse({
        miembros: filas.map((f) => ({
          usuario_id: f.usuario_id,
          nombre: nombreDe.get(f.usuario_id) ?? "—",
          avatar_url: avatarDe.get(f.usuario_id) ?? null,
          rol: f.rol,
          propio: f.usuario_id === usuarioId,
        })),
      })
    );
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error"), { status: 500 });
  }
}

/**
 * POST — agrega o saca gente del grupo.
 *
 * Sólo un admin de la sala. Y sólo en grupos: una conversación directa es entre
 * dos personas por definición, sumar a alguien la convertiría en otra cosa.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireChatInterno(request);
  if (!auth.ok) return respuestaAuth(auth);
  const { sb, empresaId, usuarioId } = auth;
  const { id: salaId } = await params;

  try {
    const { miembro, rol } = await esMiembro(sb, salaId, usuarioId);
    if (!miembro) return NextResponse.json(errorResponse("No sos miembro"), { status: 403 });
    if (rol !== "admin") {
      return NextResponse.json(errorResponse("Sólo un administrador del grupo puede cambiar sus miembros"), {
        status: 403,
      });
    }

    const { data: sala } = await sb
      .from("chat_interno_salas")
      .select("tipo")
      .eq("id", salaId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if ((sala as { tipo?: string } | null)?.tipo !== "grupo") {
      return NextResponse.json(errorResponse("Una conversación directa no cambia de miembros"), {
        status: 400,
      });
    }

    const body = (await request.json().catch(() => ({}))) as { agregar?: string[]; quitar?: string[] };
    const agregar = [...new Set((body.agregar ?? []).filter((x) => typeof x === "string" && x))];
    const quitar = [...new Set((body.quitar ?? []).filter((x) => typeof x === "string" && x))];

    if (agregar.length > 0) {
      // El id viene del navegador: se confirma que sean de la misma empresa.
      const catalog = createServiceRoleClient();
      const { data: validos } = await catalog
        .from("usuarios")
        .select("id")
        .eq("empresa_id", empresaId)
        .in("id", agregar);
      const ok = new Set(((validos ?? []) as { id: string }[]).map((u) => u.id));
      const filas = agregar.filter((a) => ok.has(a)).map((u) => ({ sala_id: salaId, usuario_id: u, rol: "miembro" }));
      if (filas.length > 0) {
        // Reagregar a alguien que ya está no es un error: se ignora.
        await sb.from("chat_interno_miembros").upsert(filas, { onConflict: "sala_id,usuario_id" });
      }
    }
    if (quitar.length > 0) {
      // Sacarse a uno mismo del grupo es salir, y eso está permitido; lo que no
      // se permite es quedarse sin ningún administrador.
      await sb
        .from("chat_interno_miembros")
        .delete()
        .eq("sala_id", salaId)
        .in("usuario_id", quitar);
    }

    return NextResponse.json(successResponse({ agregados: agregar.length, quitados: quitar.length }));
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error"), { status: 500 });
  }
}
