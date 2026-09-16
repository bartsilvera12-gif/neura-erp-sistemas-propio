import { requireSoporteApi } from "@/lib/soporte/soporte-auth";
import { nombreEstadoSubtarea } from "@/lib/soporte/dominio";
import {
  errorInesperado,
  falla,
  leerCatalogos,
  ok,
  personasPorId,
  sinPermiso,
  ticketDeEmpresa,
} from "@/lib/soporte/servidor";

type Params = { params: Promise<{ id: string }> };

type Fila = {
  id: string;
  tipo_evento: string;
  usuario_id: string | null;
  valor_anterior: string | null;
  valor_nuevo: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

/**
 * GET — la auditoría del ticket, en orden cronológico.
 *
 * Los valores se guardan como códigos e ids —que no cambian— y se traducen acá
 * al nombre ACTUAL: renombrar un estado en Configuración no deja el historial
 * mostrando nombres que ya no existen.
 */
export async function GET(request: Request, { params }: Params) {
  const auth = await requireSoporteApi(request);
  if (!auth.ok) return sinPermiso(auth);
  try {
    const { id } = await params;
    if (!(await ticketDeEmpresa(auth.sb, auth.empresaId, id, "id"))) return falla("Ticket no encontrado", 404);

    const { data, error } = await auth.sb
      .from("soporte_ticket_historial")
      .select("id, tipo_evento, usuario_id, valor_anterior, valor_nuevo, metadata, created_at")
      .eq("empresa_id", auth.empresaId)
      .eq("ticket_id", id)
      .order("created_at", { ascending: true });
    if (error) return falla(error.message);

    const filas = (data ?? []) as Fila[];
    const cat = await leerCatalogos(auth.sb, auth.empresaId);

    const idsPersona = new Set<string>();
    for (const f of filas) {
      if (f.usuario_id) idsPersona.add(f.usuario_id);
      if (f.tipo_evento === "cambio_responsable") {
        if (f.valor_anterior) idsPersona.add(f.valor_anterior);
        if (f.valor_nuevo) idsPersona.add(f.valor_nuevo);
      }
    }
    const personas = await personasPorId([...idsPersona]);

    const traducir = (evento: string, v: string | null): string | null => {
      if (v == null) return null;
      if (["cambio_estado", "entrega_qa", "devolucion_qa", "confirmacion_qa", "cierre", "cancelacion", "reapertura", "creacion"].includes(evento)) {
        return cat.estados.find((e) => e.codigo === v)?.nombre ?? v;
      }
      if (evento === "cambio_prioridad") return cat.prioridades.find((p) => p.codigo === v)?.nombre ?? v;
      if (evento === "cambio_clasificacion") return cat.clasificaciones.find((c) => c.codigo === v)?.nombre ?? v;
      if (evento === "cambio_tipo") return cat.tipos.find((t) => t.codigo === v)?.nombre ?? v;
      if (evento === "cambio_responsable") return personas.get(v)?.nombre ?? "Usuario";
      if (evento === "cambio_sla") return `${v} h`;
      if (evento === "subtarea_estado") return nombreEstadoSubtarea(v);
      return v;
    };

    return ok(
      filas.map((f) => ({
        ...f,
        usuario: f.usuario_id ? (personas.get(f.usuario_id) ?? null) : null,
        anterior: traducir(f.tipo_evento, f.valor_anterior),
        nuevo: traducir(f.tipo_evento, f.valor_nuevo),
      }))
    );
  } catch (e) {
    return errorInesperado(e);
  }
}
