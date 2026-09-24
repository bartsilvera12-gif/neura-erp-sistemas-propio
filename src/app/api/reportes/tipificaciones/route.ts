import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireModulosApiAccess } from "@/lib/contabilidad/contabilidad-auth";

export const runtime = "nodejs";

/**
 * GET /api/reportes/tipificaciones
 *
 * Reporte de tipificaciones agrupadas por Estado (familia) con drill-down a
 * Sub-estado, más un ranking por usuario. Para reportería del equipo: cuántas
 * Solicitudes / Reclamos / Consultas hubo, y de qué sub-tipo.
 *
 * Modelo (ver tipificaciones-catalogo-config): en `tipificaciones`,
 * `familia_id` = Estado (top) y `estado_id` = Sub-estado; `tipo_gestion` y
 * `resultado` guardan los NOMBRES (fallback para tipificaciones viejas sin ids).
 * Los sub-estados con `comportamiento` ticket_error/ticket_cambio disparan un
 * ticket de Soporte (`soporte_tickets.tipificacion_id`).
 *
 * Filtros: ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&cliente_id=&usuario_id=
 */

type TipRow = {
  id: string;
  cliente_id: string | null;
  fecha: string | null;
  usuario: string | null;
  usuario_id: string | null;
  tipo_gestion: string | null;
  resultado: string | null;
  familia_id: string | null;
  estado_id: string | null;
};

type SubBucket = { id: string | null; nombre: string; comportamiento: string | null; total: number; con_ticket: number };
type EstadoBucket = { id: string | null; nombre: string; total: number; con_ticket: number; subestados: Map<string, SubBucket> };

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function GET(request: NextRequest) {
  // Reportería del equipo: admin, o quien tenga el módulo Soporte o Clientes.
  const auth = await requireModulosApiAccess(request, ["soporte", "clientes"], "Reportes");
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

  try {
    const url = new URL(request.url);
    const desde = url.searchParams.get("desde") || undefined;
    const hasta = url.searchParams.get("hasta") || undefined;
    const clienteId = url.searchParams.get("cliente_id") || undefined;
    const usuarioId = url.searchParams.get("usuario_id") || undefined;

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    // 1) Tipificaciones del período/filtros.
    let q = sb
      .from("tipificaciones")
      .select("id, cliente_id, fecha, usuario, usuario_id, tipo_gestion, resultado, familia_id, estado_id")
      .eq("empresa_id", auth.empresaId);
    if (desde) q = q.gte("fecha", desde);
    if (hasta) q = q.lte("fecha", `${hasta}T23:59:59.999`);
    if (clienteId) q = q.eq("cliente_id", clienteId);
    if (usuarioId) q = q.eq("usuario_id", usuarioId);
    const { data, error } = await q.order("fecha", { ascending: false }).limit(50000);
    if (error) return NextResponse.json(errorResponse(error.message), { status: 500 });
    const rows = (data ?? []) as TipRow[];

    // 2) Catálogo (nombres canónicos + comportamiento de cada sub-estado).
    const [famRes, estRes] = await Promise.all([
      sb.from("tipificacion_familias").select("id, nombre, sort_order").eq("empresa_id", auth.empresaId),
      sb.from("tipificacion_estados").select("id, familia_id, nombre, sort_order, comportamiento").eq("empresa_id", auth.empresaId),
    ]);
    const famById = new Map<string, { nombre: string; sort: number }>();
    for (const f of (famRes.data ?? []) as { id: string; nombre: string; sort_order: number | null }[]) {
      famById.set(f.id, { nombre: f.nombre, sort: f.sort_order ?? 0 });
    }
    const estById = new Map<string, { nombre: string; comportamiento: string | null; sort: number }>();
    for (const e of (estRes.data ?? []) as { id: string; nombre: string; comportamiento: string | null; sort_order: number | null }[]) {
      estById.set(e.id, { nombre: e.nombre, comportamiento: e.comportamiento, sort: e.sort_order ?? 0 });
    }

    // 3) Qué tipificaciones generaron ticket de Soporte (vínculo inverso).
    //    Drift-safe: si la tabla/columna no existe en este tenant, se cuenta 0.
    const conTicket = new Set<string>();
    if (rows.length > 0) {
      try {
        for (const ids of chunk(rows.map((r) => r.id), 200)) {
          const { data: tks } = await sb
            .from("soporte_tickets")
            .select("tipificacion_id")
            .eq("empresa_id", auth.empresaId)
            .in("tipificacion_id", ids);
          for (const t of (tks ?? []) as { tipificacion_id: string | null }[]) {
            if (t.tipificacion_id) conTicket.add(t.tipificacion_id);
          }
        }
      } catch {
        /* tenant sin módulo Soporte: sin tickets */
      }
    }

    // 4) Agrupar por Estado → Sub-estado.
    const estados = new Map<string, EstadoBucket>();
    const usuarios = new Map<string, { id: string | null; nombre: string; total: number }>();

    for (const r of rows) {
      const conTk = conTicket.has(r.id) ? 1 : 0;

      // Estado (familia)
      const famKey = r.familia_id ?? `txt:${(r.tipo_gestion ?? "Sin estado").trim()}`;
      const famNombre = (r.familia_id && famById.get(r.familia_id)?.nombre) || (r.tipo_gestion ?? "Sin estado");
      let est = estados.get(famKey);
      if (!est) {
        est = { id: r.familia_id ?? null, nombre: famNombre, total: 0, con_ticket: 0, subestados: new Map() };
        estados.set(famKey, est);
      }
      est.total += 1;
      est.con_ticket += conTk;

      // Sub-estado
      const subKey = r.estado_id ?? `txt:${(r.resultado ?? "Sin sub-estado").trim()}`;
      const subCat = r.estado_id ? estById.get(r.estado_id) : undefined;
      const subNombre = subCat?.nombre || (r.resultado ?? "Sin sub-estado");
      let sub = est.subestados.get(subKey);
      if (!sub) {
        sub = { id: r.estado_id ?? null, nombre: subNombre, comportamiento: subCat?.comportamiento ?? null, total: 0, con_ticket: 0 };
        est.subestados.set(subKey, sub);
      }
      sub.total += 1;
      sub.con_ticket += conTk;

      // Usuario
      const uKey = r.usuario_id ?? `txt:${(r.usuario ?? "—").trim()}`;
      let u = usuarios.get(uKey);
      if (!u) {
        u = { id: r.usuario_id ?? null, nombre: r.usuario ?? "—", total: 0 };
        usuarios.set(uKey, u);
      }
      u.total += 1;
    }

    const estadosOut = Array.from(estados.values())
      .map((e) => ({
        id: e.id,
        nombre: e.nombre,
        total: e.total,
        con_ticket: e.con_ticket,
        subestados: Array.from(e.subestados.values()).sort((a, b) => b.total - a.total),
      }))
      .sort((a, b) => b.total - a.total);

    const usuariosOut = Array.from(usuarios.values()).sort((a, b) => b.total - a.total);

    return NextResponse.json(
      successResponse({
        desde: desde ?? null,
        hasta: hasta ?? null,
        total: rows.length,
        con_ticket: conTicket.size,
        estados: estadosOut,
        usuarios: usuariosOut,
      }),
    );
  } catch (err) {
    console.error("[/api/reportes/tipificaciones GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo generar el reporte de tipificaciones."), { status: 500 });
  }
}
