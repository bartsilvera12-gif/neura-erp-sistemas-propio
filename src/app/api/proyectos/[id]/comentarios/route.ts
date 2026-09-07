import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import {
  candidatosMencionDe,
  esCanalComentario,
  permisoComentariosDe,
} from "@/lib/proyectos/comentarios-permisos";
import { notificarComentarioProyecto } from "@/lib/proyectos/comentario-notificaciones";
import { comentarioAdjuntoPrefix } from "@/lib/proyectos/proyectos-archivos-storage";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  const { id } = await params;
  const pid = id?.trim() ?? "";
  if (!pid) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    // Filtro por canal en el SERVIDOR: un comercial no debe recibir los
    // comentarios de desarrollo (y viceversa) ni siquiera en la respuesta.
    const permiso = await permisoComentariosDe(sb, auth.empresaId, auth.usuarioCatalogId, pid);
    const { data, error } = await sb
      .from("proyecto_comentarios")
      .select("*")
      .eq("empresa_id", auth.empresaId)
      .eq("proyecto_id", pid)
      .in("canal", permiso.canales)
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    const rows = (data ?? []) as { usuario_id: string }[];
    const uids = [...new Set(rows.map((r) => r.usuario_id))];
    const catalog = createServiceRoleClient();
    const { data: names } =
      uids.length > 0
        ? await catalog.from("usuarios").select("id, nombre").eq("empresa_id", auth.empresaId).in("id", uids)
        : { data: [] as { id: string; nombre?: string }[] };
    const nameMap = new Map((names ?? []).map((u) => [u.id, u.nombre ?? ""]));

    const rich = rows.map((r) => ({
      ...r,
      usuario_nombre: nameMap.get(r.usuario_id) ?? null,
    }));

    return NextResponse.json(successResponse(rich));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  const { id } = await params;
  const pid = id?.trim() ?? "";
  if (!pid) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

  try {
    const body = (await request.json().catch(() => null)) as
      | {
          comentario?: string;
          canal?: string;
          reenviar_de?: string;
          menciones?: string[];
          adjuntos?: Array<{ path?: string; nombre?: string; mime_type?: string; size_bytes?: number }>;
        }
      | null;
    const texto = typeof body?.comentario === "string" ? body.comentario.trim() : "";
    const reenviarDe = typeof body?.reenviar_de === "string" ? body.reenviar_de.trim() : "";
    const esReenvio = reenviarDe.length > 0;

    // Adjuntos (imágenes ya subidas): se validan y se quedan sólo los paths de
    // ESTE proyecto/comentarios, para no referenciar archivos de otro lado.
    const prefijoAdjuntos = comentarioAdjuntoPrefix(auth.empresaId, pid);
    const adjuntos = Array.isArray(body?.adjuntos)
      ? body.adjuntos
          .filter(
            (a) =>
              a &&
              typeof a.path === "string" &&
              a.path.startsWith(prefijoAdjuntos)
          )
          .slice(0, 10)
          .map((a) => ({
            path: String(a.path),
            nombre: typeof a.nombre === "string" ? a.nombre.slice(0, 200) : "imagen",
            mime_type: typeof a.mime_type === "string" ? a.mime_type : "image/*",
            size_bytes: typeof a.size_bytes === "number" ? a.size_bytes : 0,
          }))
      : [];

    // Hace falta texto salvo que sea un reenvío o que traiga imágenes.
    if (!esReenvio && !texto && adjuntos.length === 0) {
      return NextResponse.json(errorResponse("comentario obligatorio"), { status: 400 });
    }
    if (!esCanalComentario(body?.canal)) {
      return NextResponse.json(errorResponse("canal inválido"), { status: 400 });
    }
    const canal = body.canal;

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const catalog = createServiceRoleClient();

    // Menciones: ids de usuario, no nombres. El nombre puede cambiar o
    // repetirse —en esta empresa hay dos Iván y dos Ayala— y la mención tiene
    // que seguir apuntando a la persona correcta.
    const mencionesPedidas = Array.isArray(body?.menciones)
      ? [...new Set((body.menciones as unknown[]).filter((m): m is string => typeof m === "string" && !!m.trim()))]
      : [];

    // Sólo se puede escribir en un canal que el usuario puede ver.
    const permiso = await permisoComentariosDe(sb, auth.empresaId, auth.usuarioCatalogId, pid);
    if (!permiso.canales.includes(canal)) {
      return NextResponse.json(
        errorResponse("No tenés acceso a ese canal de comentarios"),
        { status: 403 }
      );
    }

    // Reenvío: se arma el snapshot del original DESDE la base (no se confía en el
    // cliente), así el mensaje va tal cual con su autor y su fecha.
    let reenvio: Record<string, unknown> | null = null;
    if (esReenvio) {
      const { data: orig } = await sb
        .from("proyecto_comentarios")
        .select("id, usuario_id, comentario, created_at, canal")
        .eq("empresa_id", auth.empresaId)
        .eq("proyecto_id", pid)
        .eq("id", reenviarDe)
        .maybeSingle();
      if (!orig) {
        return NextResponse.json(errorResponse("Comentario a reenviar no encontrado"), { status: 404 });
      }
      const o = orig as {
        id: string;
        usuario_id: string;
        comentario: string;
        created_at: string;
        canal?: string | null;
      };
      const canalOrigen = o.canal ?? "comercial";
      // Debe poder ver el canal del comentario que reenvía.
      if (!permiso.canales.some((k) => k === canalOrigen)) {
        return NextResponse.json(
          errorResponse("No tenés acceso al comentario que querés reenviar"),
          { status: 403 }
        );
      }
      const { data: autorOrig } = await catalog
        .from("usuarios")
        .select("nombre")
        .eq("id", o.usuario_id)
        .maybeSingle();
      reenvio = {
        comentario_id: o.id,
        autor_id: o.usuario_id,
        autor_nombre: (autorOrig as { nombre?: string } | null)?.nombre ?? null,
        texto: o.comentario ?? "",
        fecha: o.created_at,
        canal_origen: canalOrigen,
      };
    }

    // Sólo se puede mencionar a quien PUEDE VER el canal. Se valida acá y no en
    // el navegador: mencionar a alguien que no lo ve sería avisarle de algo que
    // después no puede abrir, y el body se arma a mano con dos líneas.
    let menciones: string[] = [];
    if (mencionesPedidas.length > 0) {
      const candidatos = await candidatosMencionDe(sb, auth.empresaId, pid, canal);
      const validos = new Set(candidatos.map((c) => c.id));
      menciones = mencionesPedidas.filter((m) => validos.has(m) && m !== auth.usuarioCatalogId);
    }

    const insert = {
      empresa_id: auth.empresaId,
      proyecto_id: pid,
      usuario_id: auth.usuarioCatalogId,
      // Vacío se guarda como NULL: un reenvío sin nota o una imagen sola no
      // tienen texto, y "" no es un texto, es la ausencia de uno.
      comentario: texto || null,
      canal,
      ...(reenvio ? { reenvio } : {}),
      ...(adjuntos.length > 0 ? { adjuntos } : {}),
      ...(menciones.length > 0 ? { menciones } : {}),
    };

    const { data, error } = await sb.from("proyecto_comentarios").insert(insert).select("*");
    if (error) {
      // El mensaje crudo de Postgres —"violates check constraint chk_..."— no
      // le dice nada a quien está escribiendo un comentario, y se veía tal cual
      // en la pantalla. Se traduce lo conocido y el resto queda genérico.
      const msg = error.message ?? "";
      if (msg.includes("chk_proyecto_comentarios_contenido")) {
        return NextResponse.json(
          errorResponse("Escribí un comentario, adjuntá una imagen o reenviá uno existente"),
          { status: 400 }
        );
      }
      if (msg.includes("chk_proyecto_comentarios_canal")) {
        return NextResponse.json(errorResponse("Canal de comentarios inválido"), { status: 400 });
      }
      console.error("[proyecto_comentarios] insert", msg);
      return NextResponse.json(errorResponse("No se pudo publicar el comentario"), { status: 400 });
    }

    await sb
      .from("proyectos")
      .update({ last_activity_at: new Date().toISOString(), updated_by: auth.usuarioCatalogId })
      .eq("empresa_id", auth.empresaId)
      .eq("id", pid);

    const { data: u } = await catalog
      .from("usuarios")
      .select("nombre")
      .eq("id", auth.usuarioCatalogId)
      .maybeSingle();
    const autorNombre = (u as { nombre?: string } | null)?.nombre ?? null;

    // Notifica al "otro lado" del canal (+ admins). No bloqueante: nunca lanza.
    // En un reenvío sin nota, el cuerpo usa el texto del comentario reenviado.
    await notificarComentarioProyecto(sb, {
      empresaId: auth.empresaId,
      proyectoId: pid,
      canal,
      actorId: auth.usuarioCatalogId,
      actorNombre: autorNombre,
      texto:
        texto ||
        (reenvio ? String(reenvio.texto ?? "") : "") ||
        (adjuntos.length > 0 ? "📷 Imagen" : ""),
      esReenvio,
      menciones,
    });

    const row = Array.isArray(data) ? data[0] : data;
    return NextResponse.json(
      successResponse({
        ...row,
        usuario_nombre: autorNombre,
      })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
