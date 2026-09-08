import { NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import {
  AVATAR_BUCKET,
  AVATAR_MAX_BYTES,
  avatarPath,
  ensureAvatarBucket,
  firmarAvatares,
  nombreVisible,
  requireChatInterno,
  respuestaAuth,
} from "@/lib/chat-interno/core";

export const runtime = "nodejs";

/**
 * Mi perfil dentro del chat: nombre y foto.
 *
 * Sólo el propio: el id sale de la sesión y nunca del body. Una ruta que
 * aceptara a quién editar sería una ruta para cambiarle la foto a cualquiera.
 */
export async function GET(request: Request) {
  const auth = await requireChatInterno(request);
  if (!auth.ok) return respuestaAuth(auth);
  const { sb, usuarioId } = auth;

  try {
    const catalog = createServiceRoleClient();
    const { data } = await catalog
      .from("usuarios")
      .select("id, nombre, nombre_chat, avatar_path")
      .eq("id", usuarioId)
      .maybeSingle();
    const u =
      (data as {
        id: string;
        nombre: string | null;
        nombre_chat: string | null;
        avatar_path: string | null;
      } | null) ?? null;
    if (!u) return NextResponse.json(errorResponse("Usuario no encontrado"), { status: 404 });

    const urls = await firmarAvatares(sb, [u]);
    return NextResponse.json(
      successResponse({
        usuario_id: u.id,
        nombre: nombreVisible(u),
        // El del catálogo, para poder ofrecer "volver a mi nombre real".
        nombre_catalogo: (u.nombre ?? "").trim() || "—",
        avatar_url: urls.get(u.id) ?? null,
      })
    );
  } catch (e) {
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "No se pudo cargar el perfil"),
      { status: 500 }
    );
  }
}

/**
 * PATCH — cambia el nombre con el que me muestro EN EL CHAT.
 *
 * Escribe `nombre_chat` y nunca `nombre`: el del catálogo figura en proyectos,
 * reportes y atribuciones, y un apodo del chat no puede reescribir eso.
 * Vaciarlo devuelve el nombre real.
 */
export async function PATCH(request: Request) {
  const auth = await requireChatInterno(request);
  if (!auth.ok) return respuestaAuth(auth);
  const { usuarioId } = auth;

  try {
    const body = (await request.json().catch(() => ({}))) as { nombre?: string };
    if (typeof body.nombre !== "string") {
      return NextResponse.json(errorResponse("Falta el nombre"), { status: 400 });
    }
    const nombre = body.nombre.trim().replace(/\s+/g, " ").slice(0, 60);

    const catalog = createServiceRoleClient();
    const { error } = await catalog
      .from("usuarios")
      .update({ nombre_chat: nombre || null })
      .eq("id", usuarioId);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    const { data } = await catalog
      .from("usuarios")
      .select("nombre, nombre_chat")
      .eq("id", usuarioId)
      .maybeSingle();
    return NextResponse.json(
      successResponse({
        nombre: nombreVisible((data ?? {}) as { nombre?: string; nombre_chat?: string }),
      })
    );
  } catch (e) {
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "No se pudo guardar el nombre"),
      { status: 500 }
    );
  }
}

/** POST — cambia MI foto de perfil. */
export async function POST(request: Request) {
  const auth = await requireChatInterno(request);
  if (!auth.ok) return respuestaAuth(auth);
  const { sb, empresaId, usuarioId } = auth;

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(errorResponse("Imagen vacía"), { status: 400 });
    }
    if (!(file.type || "").startsWith("image/")) {
      return NextResponse.json(errorResponse("Tiene que ser una imagen"), { status: 400 });
    }
    if (file.size > AVATAR_MAX_BYTES) {
      return NextResponse.json(errorResponse("La imagen supera los 4 MB"), { status: 400 });
    }

    await ensureAvatarBucket(sb);
    const path = avatarPath(empresaId, usuarioId, file.type);
    const { error } = await sb.storage
      .from(AVATAR_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    const catalog = createServiceRoleClient();
    // La foto anterior se borra DESPUÉS de guardar la nueva: si el borrado
    // falla, sobra un archivo; si fallara al revés, el perfil quedaría sin foto.
    const { data: previo } = await catalog
      .from("usuarios")
      .select("avatar_path")
      .eq("id", usuarioId)
      .maybeSingle();

    const { error: eUpd } = await catalog
      .from("usuarios")
      .update({ avatar_path: path })
      .eq("id", usuarioId);
    if (eUpd) return NextResponse.json(errorResponse(eUpd.message), { status: 400 });

    const anterior = (previo as { avatar_path?: string | null } | null)?.avatar_path;
    if (anterior && anterior !== path) {
      await sb.storage.from(AVATAR_BUCKET).remove([anterior]);
    }

    const urls = await firmarAvatares(sb, [{ id: usuarioId, avatar_path: path }]);
    return NextResponse.json(
      successResponse({ avatar_url: urls.get(usuarioId) ?? null }),
      { status: 201 }
    );
  } catch (e) {
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "No se pudo guardar la foto"),
      { status: 500 }
    );
  }
}

/** DELETE — saca mi foto y vuelve a las iniciales. */
export async function DELETE(request: Request) {
  const auth = await requireChatInterno(request);
  if (!auth.ok) return respuestaAuth(auth);
  const { sb, usuarioId } = auth;

  try {
    const catalog = createServiceRoleClient();
    const { data: previo } = await catalog
      .from("usuarios")
      .select("avatar_path")
      .eq("id", usuarioId)
      .maybeSingle();

    const { error } = await catalog
      .from("usuarios")
      .update({ avatar_path: null })
      .eq("id", usuarioId);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    const anterior = (previo as { avatar_path?: string | null } | null)?.avatar_path;
    if (anterior) await sb.storage.from(AVATAR_BUCKET).remove([anterior]);

    return NextResponse.json(successResponse({ avatar_url: null }));
  } catch (e) {
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "No se pudo quitar la foto"),
      { status: 500 }
    );
  }
}
