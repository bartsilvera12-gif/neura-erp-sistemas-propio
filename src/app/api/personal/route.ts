import { requirePersonalApi, ok, falla, errorInesperado, kpisDesdeIncidencias } from "@/lib/personal/servidor";
import type { FuncionarioResumen, TipoIncidencia } from "@/lib/personal/types";

/** GET /api/personal — funcionarios de la empresa con sus KPIs (últimos 12 meses). */
export async function GET(request: Request) {
  const auth = await requirePersonalApi(request);
  if (!auth.ok) return auth.respuesta;
  const { empresaId, sb } = auth.ctx;
  try {
    const { data: usuarios, error } = await sb
      .from("usuarios")
      .select("id, nombre, codigo_empleado, cargo, area, estado, fecha_ingreso, avatar_path")
      .eq("empresa_id", empresaId)
      .order("nombre", { ascending: true });
    if (error) return falla(error.message);

    // Incidencias de los últimos 12 meses para armar los KPIs de cada uno.
    const desde = new Date();
    desde.setMonth(desde.getMonth() - 12);
    const { data: inc } = await sb
      .from("personal_incidencias")
      .select("usuario_id, tipo")
      .eq("empresa_id", empresaId)
      .neq("estado", "anulada")
      .gte("fecha", desde.toISOString().slice(0, 10));

    const porUsuario = new Map<string, TipoIncidencia[]>();
    for (const r of (inc ?? []) as { usuario_id: string; tipo: TipoIncidencia }[]) {
      const lista = porUsuario.get(r.usuario_id) ?? [];
      lista.push(r.tipo);
      porUsuario.set(r.usuario_id, lista);
    }

    const filas = (usuarios ?? []) as {
      id: string; nombre: string | null; codigo_empleado: string | null;
      cargo: string | null; area: string | null; estado: string | null;
      fecha_ingreso: string | null; avatar_path: string | null;
    }[];

    const lista: FuncionarioResumen[] = filas.map((u) => ({
      id: u.id,
      nombre: u.nombre ?? "—",
      codigo_empleado: u.codigo_empleado,
      cargo: u.cargo,
      area: u.area,
      estado: u.estado,
      fecha_ingreso: u.fecha_ingreso,
      avatar_path: u.avatar_path,
      kpis: kpisDesdeIncidencias(porUsuario.get(u.id) ?? []),
    }));

    return ok({ funcionarios: lista });
  } catch (e) {
    return errorInesperado(e);
  }
}
