import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import {
  QA_OBSERVACION_SELECT,
  QA_ORIGEN_INICIAL,
  QA_SEVERIDAD_INICIAL,
  bumpProyectoActividad,
  enriquecerObservaciones,
  esErrorNumeroDuplicado,
  esQAEstado,
  esQAOrigen,
  esQASeveridad,
  existeSeccion,
  nombresUsuarios,
  registrarEventoQA,
  siguienteNumeroObservacion,
  siguienteSortOrder,
  type QAObservacionRow,
} from "@/lib/proyectos/qa-shared";

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

function textoOpcional(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  return s ? s.slice(0, max) : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

  const { id } = await params;
  const pid = id?.trim() ?? "";
  if (!pid) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

  try {
    const qs = new URL(request.url).searchParams;
    const estado = qs.get("estado")?.trim() ?? "";
    const seccionId = qs.get("seccion_id")?.trim() ?? "";
    const severidad = qs.get("severidad")?.trim() ?? "";
    const asignadoA = qs.get("asignado_a")?.trim() ?? "";
    const q = qs.get("q")?.trim() ?? "";

    if (estado && !esQAEstado(estado)) {
      return NextResponse.json(errorResponse("estado inválido"), { status: 400 });
    }
    if (severidad && !esQASeveridad(severidad)) {
      return NextResponse.json(errorResponse("severidad inválida"), { status: 400 });
    }

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    let query = sb
      .from("proyecto_qa_observaciones")
      .select(QA_OBSERVACION_SELECT)
      .eq("empresa_id", auth.empresaId)
      .eq("proyecto_id", pid);

    if (estado) query = query.eq("estado", estado);
    if (severidad) query = query.eq("severidad", severidad);
    if (asignadoA) query = query.eq("asignado_a", asignadoA);
    if (seccionId) {
      // `sin_seccion` filtra las observaciones que todavía no se clasificaron.
      query = seccionId === "sin_seccion" ? query.is("seccion_id", null) : query.eq("seccion_id", seccionId);
    }
    if (q) {
      // Escapado de los comodines de PostgREST para que el texto se busque literal.
      const patron = q.replace(/[%_,()]/g, " ").trim();
      if (patron) query = query.or(`titulo.ilike.%${patron}%,descripcion.ilike.%${patron}%`);
    }

    const { data, error } = await query
      .order("sort_order", { ascending: true })
      .order("numero", { ascending: true });
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    const observaciones = await enriquecerObservaciones(
      sb,
      auth.empresaId,
      (data ?? []) as QAObservacionRow[]
    );

    return NextResponse.json(successResponse({ observaciones }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

  const { id } = await params;
  const pid = id?.trim() ?? "";
  if (!pid) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const titulo = typeof body?.titulo === "string" ? body.titulo.trim().slice(0, 300) : "";
    if (!titulo) return NextResponse.json(errorResponse("titulo obligatorio"), { status: 400 });

    const severidad =
      typeof body?.severidad === "string" && esQASeveridad(body.severidad)
        ? body.severidad
        : QA_SEVERIDAD_INICIAL;
    const origen =
      typeof body?.origen === "string" && esQAOrigen(body.origen) ? body.origen : QA_ORIGEN_INICIAL;

    const fechaLimite = textoOpcional(body?.fecha_limite, 10);
    if (fechaLimite && !FECHA_RE.test(fechaLimite)) {
      return NextResponse.json(errorResponse("fecha_limite debe ser YYYY-MM-DD"), { status: 400 });
    }

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    const seccionId = textoOpcional(body?.seccion_id, 64);
    if (seccionId && !(await existeSeccion(sb, auth.empresaId, pid, seccionId))) {
      return NextResponse.json(errorResponse("Sección no encontrada"), { status: 400 });
    }

    const asignadoA = textoOpcional(body?.asignado_a, 64);
    if (asignadoA) {
      const nombres = await nombresUsuarios(auth.empresaId, [asignadoA]);
      if (!nombres.has(asignadoA)) {
        return NextResponse.json(errorResponse("Usuario asignado no encontrado"), { status: 400 });
      }
    }

    const sort_order = await siguienteSortOrder(sb, "proyecto_qa_observaciones", auth.empresaId, {
      proyecto_id: pid,
    });

    const base = {
      empresa_id: auth.empresaId,
      proyecto_id: pid,
      seccion_id: seccionId,
      titulo,
      descripcion: textoOpcional(body?.descripcion, 5000),
      severidad,
      origen,
      url_referencia: textoOpcional(body?.url_referencia, 2000),
      asignado_a: asignadoA,
      fecha_limite: fechaLimite,
      sort_order,
      created_by: auth.usuarioCatalogId,
    };

    // `numero` es MAX+1 sin lock: ante colisión con el UNIQUE se reintenta una vez.
    let row: QAObservacionRow | null = null;
    let ultimoError: { message: string } | null = null;
    for (let intento = 0; intento < 2 && !row; intento += 1) {
      const numero = await siguienteNumeroObservacion(sb, auth.empresaId, pid);
      const { data, error } = await sb
        .from("proyecto_qa_observaciones")
        .insert({ ...base, numero })
        .select(QA_OBSERVACION_SELECT);
      if (!error) {
        row = (Array.isArray(data) ? data[0] : data) as QAObservacionRow;
        break;
      }
      ultimoError = error;
      if (!esErrorNumeroDuplicado(error)) break;
    }
    if (!row) {
      return NextResponse.json(errorResponse(ultimoError?.message ?? "No se pudo crear la observación"), {
        status: 400,
      });
    }

    await registrarEventoQA(sb, {
      empresaId: auth.empresaId,
      proyectoId: pid,
      usuarioId: auth.usuarioCatalogId,
      accion: "observacion_creada",
      observacionId: row.id,
      payload: { numero: row.numero, titulo, severidad, origen },
    });
    await bumpProyectoActividad(sb, auth.empresaId, pid, auth.usuarioCatalogId);

    const [enriquecida] = await enriquecerObservaciones(sb, auth.empresaId, [row]);
    return NextResponse.json(successResponse(enriquecida ?? row));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
