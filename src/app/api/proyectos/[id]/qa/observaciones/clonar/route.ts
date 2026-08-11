import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import {
  QA_SECCION_SELECT,
  bumpProyectoActividad,
  registrarEventoQA,
  siguienteNumeroObservacion,
  type QASeccionRow,
} from "@/lib/proyectos/qa-shared";

type ObsOrigen = {
  seccion_id: string | null;
  titulo: string;
  descripcion: string | null;
  severidad: string;
  origen: string;
  url_referencia: string | null;
  sort_order: number;
};

/** Clave de comparación de secciones: mismo criterio que el índice único. */
const clave = (nombre: string) => nombre.trim().toLowerCase();

/**
 * Clona las observaciones de otro proyecto como molde: título, descripción,
 * severidad, origen, URL y sección. **No** copia estado, asignaciones, fechas,
 * adjuntos ni comentarios — todas entran como `pendiente`, igual que el clonado
 * del checklist (`qa/clonar`), que deja los ítems sin marcar.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

  const { id } = await params;
  const pid = id?.trim() ?? "";
  if (!pid) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const fromId = typeof body?.from_proyecto_id === "string" ? body.from_proyecto_id.trim() : "";
    if (!fromId) {
      return NextResponse.json(errorResponse("from_proyecto_id obligatorio"), { status: 400 });
    }
    if (fromId === pid) {
      return NextResponse.json(errorResponse("No se puede clonar desde el mismo proyecto"), {
        status: 400,
      });
    }

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    const [origen, seccionesOrigen, seccionesDestino] = await Promise.all([
      sb
        .from("proyecto_qa_observaciones")
        .select("seccion_id, titulo, descripcion, severidad, origen, url_referencia, sort_order")
        .eq("empresa_id", auth.empresaId)
        .eq("proyecto_id", fromId)
        .order("sort_order", { ascending: true }),
      sb
        .from("proyecto_qa_secciones")
        .select(QA_SECCION_SELECT)
        .eq("empresa_id", auth.empresaId)
        .eq("proyecto_id", fromId)
        .order("sort_order", { ascending: true }),
      sb
        .from("proyecto_qa_secciones")
        .select(QA_SECCION_SELECT)
        .eq("empresa_id", auth.empresaId)
        .eq("proyecto_id", pid),
    ]);

    if (origen.error) return NextResponse.json(errorResponse(origen.error.message), { status: 400 });

    const observaciones = (origen.data ?? []) as ObsOrigen[];
    if (observaciones.length === 0) {
      return NextResponse.json(
        errorResponse("El proyecto de origen no tiene observaciones cargadas"),
        { status: 400 }
      );
    }

    // Secciones: se reutiliza la del destino que ya tenga el mismo nombre
    // normalizado (si no, el índice único la rechazaría) y se crean las que falten.
    const destinoPorNombre = new Map(
      ((seccionesDestino.data ?? []) as QASeccionRow[]).map((s) => [clave(s.nombre), s.id])
    );
    const mapaSecciones: Record<string, string> = {};
    let seccionesCreadas = 0;

    for (const s of (seccionesOrigen.data ?? []) as QASeccionRow[]) {
      const existente = destinoPorNombre.get(clave(s.nombre));
      if (existente) {
        mapaSecciones[s.id] = existente;
        continue;
      }
      const { data: ins, error } = await sb
        .from("proyecto_qa_secciones")
        .insert({
          empresa_id: auth.empresaId,
          proyecto_id: pid,
          nombre: s.nombre,
          color: s.color,
          sort_order: s.sort_order,
          created_by: auth.usuarioCatalogId,
        })
        .select("id");
      if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
      const nuevo = (ins as Array<{ id: string }> | null)?.[0]?.id;
      if (nuevo) {
        mapaSecciones[s.id] = nuevo;
        destinoPorNombre.set(clave(s.nombre), nuevo);
        seccionesCreadas += 1;
      }
    }

    // Los correlativos siguen la numeración del destino, no la del origen.
    const desde = await siguienteNumeroObservacion(sb, auth.empresaId, pid);
    const payload = observaciones.map((o, i) => ({
      empresa_id: auth.empresaId,
      proyecto_id: pid,
      seccion_id: o.seccion_id ? mapaSecciones[o.seccion_id] ?? null : null,
      numero: desde + i,
      titulo: o.titulo,
      descripcion: o.descripcion,
      estado: "pendiente",
      severidad: o.severidad,
      origen: o.origen,
      url_referencia: o.url_referencia,
      sort_order: o.sort_order,
      created_by: auth.usuarioCatalogId,
    }));

    const { error } = await sb.from("proyecto_qa_observaciones").insert(payload);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    await registrarEventoQA(sb, {
      empresaId: auth.empresaId,
      proyectoId: pid,
      usuarioId: auth.usuarioCatalogId,
      accion: "qa_clonado",
      payload: {
        from_proyecto_id: fromId,
        observaciones: payload.length,
        secciones_creadas: seccionesCreadas,
      },
    });
    await bumpProyectoActividad(sb, auth.empresaId, pid, auth.usuarioCatalogId);

    return NextResponse.json(
      successResponse({ observaciones: payload.length, secciones_creadas: seccionesCreadas })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
