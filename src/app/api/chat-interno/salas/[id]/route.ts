import { NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import {
  AVATAR_BUCKET,
  AVATAR_MAX_BYTES,
  avatarPath,
  ensureAvatarBucket,
  esMiembro,
  firmarAvatares,
  requireChatInterno,
  respuestaAuth,
} from "@/lib/chat-interno/core";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

export const runtime = "nodejs";

/**
 * Datos del grupo: nombre, descripción y foto.
 *
 * Sólo un administrador de la sala, y sólo en grupos: una conversación directa
 * se llama con el nombre de la otra persona y se ve con su cara — ponerle un
 * nombre propio sería inventarle una identidad a algo que ya la tiene.
 */
async function requireAdminDeGrupo(
  sb: AppSupabaseClient,
  salaId: string,
  empresaId: string,
  usuarioId: string
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const { miembro, rol } = await esMiembro(sb, salaId, usuarioId);
  if (!miembro) return { ok: false, status: 403, message: "No sos miembro de esta sala" };
  if (rol !== "admin") {
    return { ok: false, status: 403, message: "Sólo un administrador del grupo puede editarlo" };
  }
  const { data } = await sb
    .from("chat_interno_salas")
    .select("tipo")
    .eq("id", salaId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if ((data as { tipo?: string } | null)?.tipo !== "grupo") {
    return { ok: false, status: 400, message: "Una conversación directa no se edita" };
  }
  return { ok: true };
}

/** GET — los datos editables de la sala, para llenar el formulario. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireChatInterno(request);
  if (!auth.ok) return respuestaAuth(auth);
  const { sb, empresaId, usuarioId } = auth;
  const { id: salaId } = await params;

  try {
    const { miembro, rol } = await esMiembro(sb, salaId, usuarioId);
    if (!miembro) return NextResponse.json(errorResponse("No sos miembro"), { status: 403 });

    const { data } = await sb
      .from("chat_interno_salas")
      .select("id, tipo, nombre, descripcion, avatar_path")
      .eq("id", salaId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    const sala = data as {
      id: string;
      tipo: string;
      nombre: string | null;
      descripcion: string | null;
      avatar_path: string | null;
    } | null;
    if (!sala) return NextResponse.json(errorResponse("Sala no encontrada"), { status: 404 });

    const urls = await firmarAvatares(sb, [{ id: sala.id, avatar_path: sala.avatar_path }]);
    return NextResponse.json(
      successResponse({
        id: sala.id,
        tipo: sala.tipo,
        nombre: sala.nombre ?? "",
        descripcion: sala.descripcion ?? "",
        avatar_url: urls.get(sala.id) ?? null,
        mi_rol: rol,
        puedo_editar: rol === "admin" && sala.tipo === "grupo",
      })
    );
  } catch (e) {
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "No se pudo cargar la sala"),
      { status: 500 }
    );
  }
}

/** PATCH — cambia nombre y/o descripción del grupo. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireChatInterno(request);
  if (!auth.ok) return respuestaAuth(auth);
  const { sb, empresaId, usuarioId } = auth;
  const { id: salaId } = await params;

  try {
    const permiso = await requireAdminDeGrupo(sb, salaId, empresaId, usuarioId);
    if (!permiso.ok) {
      return NextResponse.json(errorResponse(permiso.message), { status: permiso.status });
    }

    const body = (await request.json().catch(() => ({}))) as {
      nombre?: string;
      descripcion?: string;
    };

    const cambios: Record<string, string | null> = {};
    if (typeof body.nombre === "string") {
      const nombre = body.nombre.trim();
      // Un grupo sin nombre no se distingue de otro en la bandeja.
      if (!nombre) {
        return NextResponse.json(errorResponse("El grupo necesita un nombre"), { status: 400 });
      }
      cambios.nombre = nombre.slice(0, 80);
    }
    if (typeof body.descripcion === "string") {
      cambios.descripcion = body.descripcion.trim().slice(0, 500) || null;
    }
    if (Object.keys(cambios).length === 0) {
      return NextResponse.json(errorResponse("No hay nada que cambiar"), { status: 400 });
    }

    const { error } = await sb
      .from("chat_interno_salas")
      .update({ ...cambios, updated_at: new Date().toISOString() })
      .eq("id", salaId)
      .eq("empresa_id", empresaId);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    return NextResponse.json(successResponse(cambios));
  } catch (e) {
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "No se pudo guardar"),
      { status: 500 }
    );
  }
}

/** POST — cambia la foto del grupo (multipart, campo `file`). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireChatInterno(request);
  if (!auth.ok) return respuestaAuth(auth);
  const { sb, empresaId, usuarioId } = auth;
  const { id: salaId } = await params;

  try {
    const permiso = await requireAdminDeGrupo(sb, salaId, empresaId, usuarioId);
    if (!permiso.ok) {
      return NextResponse.json(errorResponse(permiso.message), { status: permiso.status });
    }

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
    const path = avatarPath(empresaId, salaId, file.type);
    const { error } = await sb.storage
      .from(AVATAR_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    // La anterior se borra después de guardar la nueva: si falla el borrado
    // sobra un archivo; al revés, el grupo quedaría sin foto.
    const { data: previo } = await sb
      .from("chat_interno_salas")
      .select("avatar_path")
      .eq("id", salaId)
      .maybeSingle();

    const { error: eUpd } = await sb
      .from("chat_interno_salas")
      .update({ avatar_path: path, updated_at: new Date().toISOString() })
      .eq("id", salaId)
      .eq("empresa_id", empresaId);
    if (eUpd) return NextResponse.json(errorResponse(eUpd.message), { status: 400 });

    const anterior = (previo as { avatar_path?: string | null } | null)?.avatar_path;
    if (anterior && anterior !== path) await sb.storage.from(AVATAR_BUCKET).remove([anterior]);

    const urls = await firmarAvatares(sb, [{ id: salaId, avatar_path: path }]);
    return NextResponse.json(
      successResponse({ avatar_url: urls.get(salaId) ?? null }),
      { status: 201 }
    );
  } catch (e) {
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "No se pudo guardar la foto"),
      { status: 500 }
    );
  }
}

/** DELETE — saca la foto del grupo y vuelve al ícono. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireChatInterno(request);
  if (!auth.ok) return respuestaAuth(auth);
  const { sb, empresaId, usuarioId } = auth;
  const { id: salaId } = await params;

  try {
    const permiso = await requireAdminDeGrupo(sb, salaId, empresaId, usuarioId);
    if (!permiso.ok) {
      return NextResponse.json(errorResponse(permiso.message), { status: permiso.status });
    }

    const { data: previo } = await sb
      .from("chat_interno_salas")
      .select("avatar_path")
      .eq("id", salaId)
      .maybeSingle();

    const { error } = await sb
      .from("chat_interno_salas")
      .update({ avatar_path: null, updated_at: new Date().toISOString() })
      .eq("id", salaId)
      .eq("empresa_id", empresaId);
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
