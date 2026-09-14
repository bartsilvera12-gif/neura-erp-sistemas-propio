import { requireSoporteApi } from "@/lib/soporte/soporte-auth";
import { TIPOS_RELACION } from "@/lib/soporte/dominio";
import {
  clientesPorId,
  errorInesperado,
  falla,
  leerCatalogos,
  ok,
  registrarHistorial,
  sinPermiso,
  ticketDeEmpresa,
} from "@/lib/soporte/servidor";

type Params = { params: Promise<{ id: string }> };

type Relacion = { id: string; ticket_id: string; ticket_relacionado_id: string; tipo: string; created_at: string };
type Resumen = { id: string; numero: number; asunto: string; estado_codigo: string; cliente_id: string | null };

/**
 * GET — tickets vinculados, en las dos direcciones: si A está relacionado con
 * B, B tiene que mostrar a A sin que nadie lo cargue dos veces.
 */
export async function GET(request: Request, { params }: Params) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  try {
    const { id } = await params;
    if (!(await ticketDeEmpresa(auth.sb, auth.empresaId, id, "id"))) return falla("Ticket no encontrado", 404);

    const { data, error } = await auth.sb
      .from("soporte_ticket_relaciones")
      .select("id, ticket_id, ticket_relacionado_id, tipo, created_at")
      .eq("empresa_id", auth.empresaId)
      .or(`ticket_id.eq.${id},ticket_relacionado_id.eq.${id}`)
      .order("created_at", { ascending: true });
    if (error) return falla(error.message);

    const rel = (data ?? []) as Relacion[];
    const otros = rel.map((r) => (r.ticket_id === id ? r.ticket_relacionado_id : r.ticket_id));
    let resumenes: Resumen[] = [];
    if (otros.length) {
      const { data: tk } = await auth.sb
        .from("soporte_tickets")
        .select("id, numero, asunto, estado_codigo, cliente_id")
        .eq("empresa_id", auth.empresaId)
        .in("id", otros);
      resumenes = (tk ?? []) as Resumen[];
    }
    const cat = await leerCatalogos(auth.sb, auth.empresaId);
    const clientes = await clientesPorId(auth.sb, auth.empresaId, resumenes.map((t) => t.cliente_id));

    return ok(
      rel
        .map((r) => {
          const otroId = r.ticket_id === id ? r.ticket_relacionado_id : r.ticket_id;
          const t = resumenes.find((x) => x.id === otroId);
          if (!t) return null;
          const estado = cat.estados.find((e) => e.codigo === t.estado_codigo);
          return {
            id: r.id,
            tipo: r.tipo,
            tipo_nombre: TIPOS_RELACION.find((x) => x.codigo === r.tipo)?.nombre ?? r.tipo,
            // Visto desde el otro lado: un vínculo creado en el otro ticket.
            inversa: r.ticket_id !== id,
            created_at: r.created_at,
            ticket: {
              id: t.id,
              numero: t.numero,
              asunto: t.asunto,
              estado_nombre: estado?.nombre ?? t.estado_codigo,
              estado_color: estado?.color ?? "#94a3b8",
              cliente_nombre: t.cliente_id ? (clientes.get(t.cliente_id) ?? null) : null,
            },
          };
        })
        .filter(Boolean)
    );
  } catch (e) {
    return errorInesperado(e);
  }
}

/** POST — vincula con otro ticket por su número. Body: { numero, tipo? }. */
export async function POST(request: Request, { params }: Params) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  try {
    const { id } = await params;
    const origen = await ticketDeEmpresa<{ id: string; numero: number }>(auth.sb, auth.empresaId, id, "id, numero");
    if (!origen) return falla("Ticket no encontrado", 404);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const numero = Number(String(body?.numero ?? "").replace(/^#/, ""));
    if (!Number.isInteger(numero) || numero <= 0) return falla("Indicá el número del ticket");
    const tipo = typeof body?.tipo === "string" ? body.tipo : "relacionado";
    if (!TIPOS_RELACION.some((t) => t.codigo === tipo)) return falla("Tipo de relación inválido");

    const { data: destino } = await auth.sb
      .from("soporte_tickets")
      .select("id, numero")
      .eq("empresa_id", auth.empresaId)
      .eq("numero", numero)
      .maybeSingle();
    const dst = destino as { id: string; numero: number } | null;
    if (!dst) return falla(`No existe el ticket #${numero}`);
    if (dst.id === id) return falla("Un ticket no puede relacionarse consigo mismo");

    // Evita el mismo vínculo cargado desde el otro ticket.
    const { data: existe } = await auth.sb
      .from("soporte_ticket_relaciones")
      .select("id")
      .eq("empresa_id", auth.empresaId)
      .eq("tipo", tipo)
      .or(`and(ticket_id.eq.${id},ticket_relacionado_id.eq.${dst.id}),and(ticket_id.eq.${dst.id},ticket_relacionado_id.eq.${id})`)
      .limit(1);
    if ((existe ?? []).length) return falla(`Ya está vinculado con #${numero}`);

    const { data, error } = await auth.sb
      .from("soporte_ticket_relaciones")
      .insert({ empresa_id: auth.empresaId, ticket_id: id, ticket_relacionado_id: dst.id, tipo, created_by: auth.usuarioId })
      .select("id")
      .single();
    if (error || !data) return falla(error?.message ?? "No se pudo vincular");

    // Queda en el historial de los dos tickets.
    await registrarHistorial(auth.sb, {
      empresaId: auth.empresaId,
      ticketId: id,
      usuarioId: auth.usuarioId,
      eventos: [{ tipo_evento: "relacion_agregada", valor_nuevo: `#${dst.numero}`, metadata: { tipo, relacion_id: data.id } }],
    });
    await registrarHistorial(auth.sb, {
      empresaId: auth.empresaId,
      ticketId: dst.id,
      usuarioId: auth.usuarioId,
      eventos: [{ tipo_evento: "relacion_agregada", valor_nuevo: `#${origen.numero}`, metadata: { tipo, relacion_id: data.id, inversa: true } }],
    });
    return ok({ id: data.id });
  } catch (e) {
    return errorInesperado(e);
  }
}

/** DELETE ?relacion_id=… — quita el vínculo (y lo registra en los dos tickets). */
export async function DELETE(request: Request, { params }: Params) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  try {
    const { id } = await params;
    const relacionId = new URL(request.url).searchParams.get("relacion_id") ?? "";
    const { data } = await auth.sb
      .from("soporte_ticket_relaciones")
      .select("id, ticket_id, ticket_relacionado_id, tipo")
      .eq("empresa_id", auth.empresaId)
      .eq("id", relacionId)
      .maybeSingle();
    const rel = data as Relacion | null;
    if (!rel || (rel.ticket_id !== id && rel.ticket_relacionado_id !== id)) return falla("Relación no encontrada", 404);

    const { error } = await auth.sb.from("soporte_ticket_relaciones").delete().eq("id", rel.id).eq("empresa_id", auth.empresaId);
    if (error) return falla(error.message);

    const { data: nums } = await auth.sb
      .from("soporte_tickets")
      .select("id, numero")
      .in("id", [rel.ticket_id, rel.ticket_relacionado_id]);
    const num = (tid: string) => `#${((nums ?? []) as { id: string; numero: number }[]).find((x) => x.id === tid)?.numero ?? "?"}`;
    for (const [tk, otro] of [
      [rel.ticket_id, rel.ticket_relacionado_id],
      [rel.ticket_relacionado_id, rel.ticket_id],
    ]) {
      await registrarHistorial(auth.sb, {
        empresaId: auth.empresaId,
        ticketId: tk,
        usuarioId: auth.usuarioId,
        eventos: [{ tipo_evento: "relacion_eliminada", valor_anterior: num(otro), metadata: { tipo: rel.tipo } }],
      });
    }
    return ok({ eliminada: true });
  } catch (e) {
    return errorInesperado(e);
  }
}
