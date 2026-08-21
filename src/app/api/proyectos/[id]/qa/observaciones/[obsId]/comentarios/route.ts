import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { origenesVisibles, permisoQADe } from "@/lib/proyectos/qa-permisos";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import {
  QA_OBSERVACION_COMENTARIO_SELECT,
  bumpProyectoActividad,
  esQAComentarioOrigen,
  fetchObservacion,
  nombresUsuarios,
  registrarEventoQA,
  type QAObservacionComentarioRow,
} from "@/lib/proyectos/qa-shared";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; obsId: string }> }
) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

  const { id, obsId } = await params;
  const pid = id?.trim() ?? "";
  const oid = obsId?.trim() ?? "";
  if (!pid || !oid) return NextResponse.json(errorResponse("ids obligatorios"), { status: 400 });

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    const permiso = await permisoQADe(sb, auth.empresaId, auth.usuarioCatalogId ?? "", pid);
    if (permiso.vista == null) {
      return NextResponse.json(errorResponse("No tenés acceso a QA en este proyecto."), { status: 403 });
    }

    // EL filtro que importa: el hilo 'interno' no sale de acá salvo para QA, PM
    // y admin. Se aplica en la consulta, no al renderizar, para que el
    // contenido privado no viaje siquiera al cliente de Desarrollo.
    const { data, error } = await sb
      .from("proyecto_qa_observacion_comentarios")
      .select(QA_OBSERVACION_COMENTARIO_SELECT)
      .eq("empresa_id", auth.empresaId)
      .eq("proyecto_id", pid)
      .eq("observacion_id", oid)
      .in("origen", origenesVisibles(permiso))
      .order("created_at", { ascending: true });
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    const rows = (data ?? []) as QAObservacionComentarioRow[];
    const nombres = await nombresUsuarios(auth.empresaId, rows.map((c) => c.autor_id));

    return NextResponse.json(
      successResponse({
        comentarios: rows.map((c) => ({
          ...c,
          autor_nombre: c.autor_id ? nombres.get(c.autor_id) || null : null,
        })),
      })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; obsId: string }> }
) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

  const { id, obsId } = await params;
  const pid = id?.trim() ?? "";
  const oid = obsId?.trim() ?? "";
  if (!pid || !oid) return NextResponse.json(errorResponse("ids obligatorios"), { status: 400 });

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const texto = typeof body?.texto === "string" ? body.texto.trim().slice(0, 5000) : "";
    if (!texto) return NextResponse.json(errorResponse("texto obligatorio"), { status: 400 });
    // Elige el carril donde aparece el mensaje ("Nota de QA" o "Respuesta del
    // técnico") — no depende de quién lo escribe, sino de en qué caja lo tipeó,
    // así que cualquiera con acceso puede publicar en cualquiera de los dos.
    const origen = esQAComentarioOrigen(body?.origen) ? body.origen : "qa";

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    const permiso = await permisoQADe(sb, auth.empresaId, auth.usuarioCatalogId ?? "", pid);
    if (permiso.vista == null) {
      return NextResponse.json(errorResponse("No tenés acceso a QA en este proyecto."), { status: 403 });
    }
    // Escribir en el hilo interno también se valida: si no, alguien de
    // Desarrollo podría publicar ahí mandando `origen: "interno"` a mano, y
    // aunque después no lo viera, estaría metiendo ruido en un canal privado.
    if (origen === "interno" && !permiso.puedeVerInterno) {
      return NextResponse.json(
        errorResponse("El seguimiento interno es sólo para QA y Project Manager."),
        { status: 403 }
      );
    }

    const observacion = await fetchObservacion(sb, auth.empresaId, pid, oid);
    if (!observacion) {
      return NextResponse.json(errorResponse("Observación no encontrada"), { status: 404 });
    }

    const { data, error } = await sb
      .from("proyecto_qa_observacion_comentarios")
      .insert({
        empresa_id: auth.empresaId,
        proyecto_id: pid,
        observacion_id: oid,
        texto,
        origen,
        autor_id: auth.usuarioCatalogId,
      })
      .select(QA_OBSERVACION_COMENTARIO_SELECT);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    await registrarEventoQA(sb, {
      empresaId: auth.empresaId,
      proyectoId: pid,
      usuarioId: auth.usuarioCatalogId,
      accion: "observacion_comentada",
      observacionId: oid,
      payload: { numero: observacion.numero },
    });
    await bumpProyectoActividad(sb, auth.empresaId, pid, auth.usuarioCatalogId);

    const row = (Array.isArray(data) ? data[0] : data) as QAObservacionComentarioRow;
    const nombres = await nombresUsuarios(auth.empresaId, [row.autor_id]);
    return NextResponse.json(
      successResponse({
        ...row,
        autor_nombre: row.autor_id ? nombres.get(row.autor_id) || null : null,
      })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
