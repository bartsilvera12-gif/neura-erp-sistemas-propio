import { requirePersonalApi, ok, falla, errorInesperado, nombresPorId } from "@/lib/personal/servidor";
import type { Competencia, EvaluacionDTO } from "@/lib/personal/types";

const UUID = /^[0-9a-f-]{36}$/i;
type Params = { params: Promise<{ id: string }> };

function sanearCompetencias(v: unknown): Competencia[] {
  if (!Array.isArray(v)) return [];
  const out: Competencia[] = [];
  for (const c of v) {
    if (!c || typeof c !== "object") continue;
    const nombre = typeof (c as { nombre?: unknown }).nombre === "string" ? (c as { nombre: string }).nombre.trim().slice(0, 120) : "";
    const puntaje = Number((c as { puntaje?: unknown }).puntaje);
    if (!nombre || !Number.isFinite(puntaje)) continue;
    out.push({ nombre, puntaje: Math.min(5, Math.max(0, Math.round(puntaje * 10) / 10)) });
    if (out.length >= 20) break;
  }
  return out;
}

/** GET /api/personal/:id/desempeno — evaluaciones del funcionario. */
export async function GET(request: Request, { params }: Params) {
  const auth = await requirePersonalApi(request);
  if (!auth.ok) return auth.respuesta;
  const { empresaId, sb } = auth.ctx;
  try {
    const { id } = await params;
    if (!UUID.test(id)) return falla("Funcionario inválido");

    const { data, error } = await sb
      .from("personal_evaluaciones")
      .select("id, periodo, fecha, puntaje, competencias, fortalezas, mejoras, comentario, estado, evaluador_id, evaluador_label, created_at")
      .eq("empresa_id", empresaId)
      .eq("usuario_id", id)
      .order("fecha", { ascending: false });
    if (error) return falla(error.message);
    const filas = (data ?? []) as {
      id: string; periodo: string; fecha: string; puntaje: number | null; competencias: unknown;
      fortalezas: string | null; mejoras: string | null; comentario: string | null;
      estado: EvaluacionDTO["estado"]; evaluador_id: string | null; evaluador_label: string | null; created_at: string;
    }[];

    const faltan = filas.filter((f) => !f.evaluador_label && f.evaluador_id).map((f) => f.evaluador_id);
    const nombres = faltan.length ? await nombresPorId(sb, empresaId, faltan) : new Map<string, string>();

    const evaluaciones: EvaluacionDTO[] = filas.map((f) => ({
      id: f.id,
      periodo: f.periodo,
      fecha: f.fecha,
      puntaje: f.puntaje != null ? Number(f.puntaje) : null,
      competencias: sanearCompetencias(f.competencias),
      fortalezas: f.fortalezas,
      mejoras: f.mejoras,
      comentario: f.comentario,
      estado: f.estado,
      evaluador: f.evaluador_label ?? (f.evaluador_id ? nombres.get(f.evaluador_id) ?? null : null),
      created_at: f.created_at,
    }));
    return ok({ evaluaciones });
  } catch (e) {
    return errorInesperado(e);
  }
}

/** POST /api/personal/:id/desempeno — nueva evaluación. */
export async function POST(request: Request, { params }: Params) {
  const auth = await requirePersonalApi(request);
  if (!auth.ok) return auth.respuesta;
  const { empresaId, usuarioId, sb } = auth.ctx;
  try {
    const { id } = await params;
    if (!UUID.test(id)) return falla("Funcionario inválido");
    const { data: empleado } = await sb.from("usuarios").select("id").eq("empresa_id", empresaId).eq("id", id).maybeSingle();
    if (!empleado) return falla("Funcionario no encontrado", 404);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return falla("Datos inválidos");
    const periodo = typeof body.periodo === "string" ? body.periodo.trim().slice(0, 60) : "";
    if (!periodo) return falla("Indicá el período (ej.: 2º semestre 2026)");
    const fecha = typeof body.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.fecha) ? body.fecha : null;
    const competencias = sanearCompetencias(body.competencias);
    let puntaje = Number(body.puntaje);
    if (!Number.isFinite(puntaje)) {
      puntaje = competencias.length ? competencias.reduce((s, c) => s + c.puntaje, 0) / competencias.length : NaN;
    }
    const puntajeFinal = Number.isFinite(puntaje) ? Math.min(5, Math.max(0, Math.round(puntaje * 10) / 10)) : null;
    const texto = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 4000) || null : null);
    const estado = body.estado === "borrador" ? "borrador" : "finalizada";
    const label = usuarioId ? (await nombresPorId(sb, empresaId, [usuarioId])).get(usuarioId) ?? null : null;

    const { data, error } = await sb
      .from("personal_evaluaciones")
      .insert({
        empresa_id: empresaId,
        usuario_id: id,
        periodo,
        ...(fecha ? { fecha } : {}),
        puntaje: puntajeFinal,
        competencias,
        fortalezas: texto(body.fortalezas),
        mejoras: texto(body.mejoras),
        comentario: texto(body.comentario),
        estado,
        evaluador_id: usuarioId,
        evaluador_label: label,
        created_by: usuarioId,
      })
      .select("id")
      .single();
    if (error || !data) return falla(error?.message ?? "No se pudo registrar");
    return ok({ id: (data as { id: string }).id });
  } catch (e) {
    return errorInesperado(e);
  }
}
