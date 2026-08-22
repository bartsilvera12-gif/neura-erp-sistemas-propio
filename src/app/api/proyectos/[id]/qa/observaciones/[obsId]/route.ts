import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { PROYECTOS_BUCKET } from "@/lib/proyectos/proyectos-archivos-storage";
import {
  QA_OBSERVACION_SELECT,
  bumpProyectoActividad,
  enriquecerObservaciones,
  esQAOrigen,
  esQASeveridad,
  existeSeccion,
  fetchObservacion,
  nombresUsuarios,
  registrarEventoQA,
  type QAAccion,
  type QAObservacionRow,
} from "@/lib/proyectos/qa-shared";

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Campos de texto que se limpian igual en todos los casos: vacío → null. */
function textoNullable(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  return s ? s.slice(0, max) : null;
}

function tiene(body: Record<string, unknown>, campo: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, campo);
}

export async function PATCH(
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
    if (!body) return NextResponse.json(errorResponse("Body inválido"), { status: 400 });

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const prev = await fetchObservacion(sb, auth.empresaId, pid, oid);
    if (!prev) return NextResponse.json(errorResponse("Observación no encontrada"), { status: 404 });

    const patch: Record<string, unknown> = {};
    const eventos: Array<{ accion: QAAccion; payload: Record<string, unknown> }> = [];
    const cambios: Record<string, unknown> = {};

    if (typeof body.titulo === "string") {
      const t = body.titulo.trim().slice(0, 300);
      if (!t) return NextResponse.json(errorResponse("titulo vacío"), { status: 400 });
      if (t !== prev.titulo) {
        patch.titulo = t;
        cambios.titulo = { antes: prev.titulo, despues: t };
      }
    }

    if (tiene(body, "descripcion")) {
      const d = textoNullable(body.descripcion, 5000);
      if (d !== prev.descripcion) {
        patch.descripcion = d;
        cambios.descripcion = true;
      }
    }

    if (tiene(body, "url_referencia")) {
      const u = textoNullable(body.url_referencia, 2000);
      if (u !== prev.url_referencia) {
        patch.url_referencia = u;
        cambios.url_referencia = { antes: prev.url_referencia, despues: u };
      }
    }

    if (typeof body.severidad === "string") {
      if (!esQASeveridad(body.severidad)) {
        return NextResponse.json(errorResponse("severidad inválida"), { status: 400 });
      }
      if (body.severidad !== prev.severidad) {
        patch.severidad = body.severidad;
        cambios.severidad = { antes: prev.severidad, despues: body.severidad };
      }
    }

    if (typeof body.origen === "string") {
      if (!esQAOrigen(body.origen)) {
        return NextResponse.json(errorResponse("origen inválido"), { status: 400 });
      }
      if (body.origen !== prev.origen) {
        patch.origen = body.origen;
        cambios.origen = { antes: prev.origen, despues: body.origen };
      }
    }

    if (tiene(body, "seccion_id")) {
      const s = textoNullable(body.seccion_id, 64);
      if (s && !(await existeSeccion(sb, auth.empresaId, pid, s))) {
        return NextResponse.json(errorResponse("Sección no encontrada"), { status: 400 });
      }
      if (s !== prev.seccion_id) {
        patch.seccion_id = s;
        cambios.seccion_id = { antes: prev.seccion_id, despues: s };
      }
    }

    if (tiene(body, "fecha_limite")) {
      const f = textoNullable(body.fecha_limite, 10);
      if (f && !FECHA_RE.test(f)) {
        return NextResponse.json(errorResponse("fecha_limite debe ser YYYY-MM-DD"), { status: 400 });
      }
      if (f !== prev.fecha_limite) {
        patch.fecha_limite = f;
        cambios.fecha_limite = { antes: prev.fecha_limite, despues: f };
      }
    }

    if (tiene(body, "asignado_a")) {
      const a = textoNullable(body.asignado_a, 64);
      if (a) {
        const nombres = await nombresUsuarios(auth.empresaId, [a]);
        if (!nombres.has(a)) {
          return NextResponse.json(errorResponse("Usuario asignado no encontrado"), { status: 400 });
        }
      }
      if (a !== prev.asignado_a) {
        patch.asignado_a = a;
        // La asignación tiene evento propio: es lo que se sigue en el historial.
        eventos.push({
          accion: "observacion_asignada",
          payload: { numero: prev.numero, antes: prev.asignado_a, despues: a },
        });
      }
    }

    if (typeof body.sort_order === "number" && Number.isFinite(body.sort_order)) {
      patch.sort_order = Math.floor(body.sort_order);
    }

    if (Object.keys(patch).length === 0) {
      const [sinCambios] = await enriquecerObservaciones(sb, auth.empresaId, [prev]);
      return NextResponse.json(successResponse(sinCambios ?? prev));
    }

    if (Object.keys(cambios).length > 0) {
      eventos.unshift({ accion: "observacion_editada", payload: { numero: prev.numero, cambios } });
    }

    const { data, error } = await sb
      .from("proyecto_qa_observaciones")
      .update(patch)
      .eq("empresa_id", auth.empresaId)
      .eq("proyecto_id", pid)
      .eq("id", oid)
      .select(QA_OBSERVACION_SELECT);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    for (const ev of eventos) {
      await registrarEventoQA(sb, {
        empresaId: auth.empresaId,
        proyectoId: pid,
        usuarioId: auth.usuarioCatalogId,
        accion: ev.accion,
        observacionId: oid,
        payload: ev.payload,
      });
    }
    await bumpProyectoActividad(sb, auth.empresaId, pid, auth.usuarioCatalogId);

    const row = (Array.isArray(data) ? data[0] : data) as QAObservacionRow;
    const [enriquecida] = await enriquecerObservaciones(sb, auth.empresaId, [row]);
    return NextResponse.json(successResponse(enriquecida ?? row));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function DELETE(
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
    const prev = await fetchObservacion(sb, auth.empresaId, pid, oid);
    if (!prev) return NextResponse.json(errorResponse("Observación no encontrada"), { status: 404 });

    // Los objetos de storage no se borran en cascada: hay que juntarlos antes.
    const { data: archivos } = await sb
      .from("proyecto_qa_observacion_archivos")
      .select("storage_bucket, storage_path")
      .eq("empresa_id", auth.empresaId)
      .eq("observacion_id", oid);

    const { error } = await sb
      .from("proyecto_qa_observaciones")
      .delete()
      .eq("empresa_id", auth.empresaId)
      .eq("proyecto_id", pid)
      .eq("id", oid);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    // Las filas ya no están (CASCADE): si el storage falla queda basura, no datos huérfanos.
    const porBucket = new Map<string, string[]>();
    for (const a of (archivos ?? []) as Array<{ storage_bucket: string | null; storage_path: string }>) {
      const bucket = a.storage_bucket || PROYECTOS_BUCKET;
      const paths = porBucket.get(bucket) ?? [];
      paths.push(a.storage_path);
      porBucket.set(bucket, paths);
    }
    await Promise.all(
      [...porBucket.entries()].map(([bucket, paths]) =>
        sb.storage
          .from(bucket)
          .remove(paths)
          .catch(() => {})
      )
    );

    await registrarEventoQA(sb, {
      empresaId: auth.empresaId,
      proyectoId: pid,
      usuarioId: auth.usuarioCatalogId,
      accion: "observacion_eliminada",
      payload: { id: oid, numero: prev.numero, titulo: prev.titulo },
    });
    await bumpProyectoActividad(sb, auth.empresaId, pid, auth.usuarioCatalogId);

    return NextResponse.json(successResponse({ id: oid }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
