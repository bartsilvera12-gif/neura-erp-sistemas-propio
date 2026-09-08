import { NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import {
  esMiembro,
  firmarAvatares,
  nombreVisible,
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
          .select("id, nombre, nombre_chat, avatar_path")
          .in("id", filas.map((f) => f.usuario_id))
      : { data: [] as {
          id: string;
          nombre: string | null;
          nombre_chat: string | null;
          avatar_path: string | null;
        }[] };
    const personas = (usuarios ?? []) as {
      id: string;
      nombre: string | null;
      nombre_chat: string | null;
      avatar_path: string | null;
    }[];
    const nombreDe = new Map(personas.map((u) => [u.id, nombreVisible(u)]));
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
 * POST — agrega, saca, o cambia el rol de la gente del grupo.
 *
 * Agregar, sacar a otros y nombrar administradores es de un admin de la sala.
 * Sacarse a UNO MISMO es salir del grupo, y eso puede hacerlo cualquiera:
 * quedarse encerrado en una conversación no es una regla, es un encierro.
 *
 * Y sólo en grupos: una conversación directa es entre dos personas por
 * definición, sumar a alguien la convertiría en otra cosa.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireChatInterno(request);
  if (!auth.ok) return respuestaAuth(auth);
  const { sb, empresaId, usuarioId } = auth;
  const { id: salaId } = await params;

  try {
    const { miembro, rol } = await esMiembro(sb, salaId, usuarioId);
    if (!miembro) return NextResponse.json(errorResponse("No sos miembro"), { status: 403 });

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

    const body = (await request.json().catch(() => ({}))) as {
      agregar?: string[];
      quitar?: string[];
      promover?: string[];
      degradar?: string[];
    };
    const lista = (x: unknown) => [
      ...new Set((Array.isArray(x) ? x : []).filter((v): v is string => typeof v === "string" && !!v)),
    ];
    const agregar = lista(body.agregar);
    const quitar = lista(body.quitar);
    const promover = lista(body.promover);
    const degradar = lista(body.degradar);

    // Lo único que puede hacer quien no es admin es salir.
    const soloSale =
      agregar.length === 0 &&
      promover.length === 0 &&
      degradar.length === 0 &&
      quitar.length === 1 &&
      quitar[0] === usuarioId;
    if (rol !== "admin" && !soloSale) {
      return NextResponse.json(
        errorResponse("Sólo un administrador del grupo puede cambiar sus miembros"),
        { status: 403 }
      );
    }

    // Un grupo sin ningún administrador no se puede volver a administrar: nadie
    // podría sumar gente, renombrarlo, ni siquiera cerrarlo. Se cuenta una sola
    // vez, contra lo que quedaría después de TODOS los cambios de este pedido:
    // mirarlos por separado dejaría pasar "me saco y me degrado a la vez".
    if (quitar.length > 0 || degradar.length > 0) {
      const { data: admins } = await sb
        .from("chat_interno_miembros")
        .select("usuario_id")
        .eq("sala_id", salaId)
        .eq("rol", "admin");
      const idsAdmin = ((admins ?? []) as { usuario_id: string }[]).map((a) => a.usuario_id);
      const quedan = [...new Set([...idsAdmin, ...promover])].filter(
        (a) => !quitar.includes(a) && !degradar.includes(a)
      );
      if (idsAdmin.length > 0 && quedan.length === 0) {
        return NextResponse.json(
          errorResponse("El grupo quedaría sin administrador. Nombrá a otro primero."),
          { status: 400 }
        );
      }
    }

    // Cambios de rol. Sólo sobre quien YA está en la sala: el `eq` de sala_id
    // hace que un id de otra conversación no toque nada.
    for (const [ids, nuevoRol] of [
      [promover, "admin"],
      [degradar, "miembro"],
    ] as const) {
      if (ids.length === 0) continue;
      await sb
        .from("chat_interno_miembros")
        .update({ rol: nuevoRol })
        .eq("sala_id", salaId)
        .in("usuario_id", ids);
    }

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

    return NextResponse.json(
      successResponse({
        agregados: agregar.length,
        quitados: quitar.length,
        promovidos: promover.length,
        degradados: degradar.length,
      })
    );
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error"), { status: 500 });
  }
}
