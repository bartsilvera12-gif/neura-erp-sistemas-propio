import { requirePersonalApi, ok, falla, errorInesperado, nombresPorId } from "@/lib/personal/servidor";
import { esTipoIncidencia, esEstadoIncidencia, type IncidenciaDTO } from "@/lib/personal/types";

const UUID = /^[0-9a-f-]{36}$/i;
type Params = { params: Promise<{ id: string }> };

function desdePeriodo(periodo: string | null): string | null {
  const d = new Date();
  switch (periodo) {
    case "3m": d.setMonth(d.getMonth() - 3); break;
    case "6m": d.setMonth(d.getMonth() - 6); break;
    case "12m": d.setMonth(d.getMonth() - 12); break;
    case "24m": d.setMonth(d.getMonth() - 24); break;
    default: return null; // "todos"
  }
  return d.toISOString().slice(0, 10);
}

/** GET /api/personal/:id/incidencias?tipo=&estado=&periodo= */
export async function GET(request: Request, { params }: Params) {
  const auth = await requirePersonalApi(request);
  if (!auth.ok) return auth.respuesta;
  const { empresaId, sb } = auth.ctx;
  try {
    const { id } = await params;
    if (!UUID.test(id)) return falla("Funcionario inválido");
    const sp = new URL(request.url).searchParams;
    const tipo = sp.get("tipo");
    const estado = sp.get("estado");
    const desde = desdePeriodo(sp.get("periodo") ?? "12m");

    let q = sb
      .from("personal_incidencias")
      .select("id, fecha, tipo, descripcion, estado, registrado_por_id, registrado_por_label, created_at")
      .eq("empresa_id", empresaId)
      .eq("usuario_id", id)
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false });
    if (tipo && tipo !== "todos" && esTipoIncidencia(tipo)) q = q.eq("tipo", tipo);
    if (estado && estado !== "todos" && esEstadoIncidencia(estado)) q = q.eq("estado", estado);
    if (desde) q = q.gte("fecha", desde);

    const { data, error } = await q;
    if (error) return falla(error.message);
    const filas = (data ?? []) as {
      id: string; fecha: string; tipo: IncidenciaDTO["tipo"]; descripcion: string;
      estado: IncidenciaDTO["estado"]; registrado_por_id: string | null; registrado_por_label: string | null; created_at: string;
    }[];

    // "Registrado por": usa el label guardado; si falta, resuelve el nombre por id.
    const faltan = filas.filter((f) => !f.registrado_por_label && f.registrado_por_id).map((f) => f.registrado_por_id);
    const nombres = faltan.length ? await nombresPorId(sb, empresaId, faltan) : new Map<string, string>();

    const incidencias: IncidenciaDTO[] = filas.map((f) => ({
      id: f.id,
      fecha: f.fecha,
      tipo: f.tipo,
      descripcion: f.descripcion,
      estado: f.estado,
      registrado_por: f.registrado_por_label ?? (f.registrado_por_id ? nombres.get(f.registrado_por_id) ?? null : null),
      created_at: f.created_at,
    }));
    return ok({ incidencias });
  } catch (e) {
    return errorInesperado(e);
  }
}

/** POST /api/personal/:id/incidencias — registra una incidencia/observación. */
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
    if (!esTipoIncidencia(body.tipo)) return falla("Elegí el tipo de incidencia");
    const descripcion = typeof body.descripcion === "string" ? body.descripcion.trim().slice(0, 5000) : "";
    if (!descripcion) return falla("Escribí una descripción");
    const estado = esEstadoIncidencia(body.estado) ? body.estado : "finalizada";
    const fecha = typeof body.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.fecha) ? body.fecha : null;

    const label = usuarioId ? (await nombresPorId(sb, empresaId, [usuarioId])).get(usuarioId) ?? null : null;

    const { data, error } = await sb
      .from("personal_incidencias")
      .insert({
        empresa_id: empresaId,
        usuario_id: id,
        tipo: body.tipo,
        descripcion,
        estado,
        ...(fecha ? { fecha } : {}),
        registrado_por_id: usuarioId,
        registrado_por_label: label,
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
