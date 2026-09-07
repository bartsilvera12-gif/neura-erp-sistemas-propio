import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { msLaborables } from "@/lib/proyectos/reloj-laboral";

export type ProyectoEnriquecido = Record<string, unknown> & {
  proyecto_tipo?: { id: string; nombre?: string; codigo?: string } | null;
  proyecto_estado?: {
    id: string;
    nombre?: string;
    codigo?: string;
    color?: string;
    tipo_sla?: string;
    cuenta_sla?: boolean;
    sla_horas_objetivo?: number | null;
    es_estado_final?: boolean;
  } | null;
  cliente?: {
    id: string;
    tipo_cliente?: string | null;
    empresa?: string | null;
    nombre_contacto?: string | null;
    nombre?: string | null;
    razon_social?: string | null;
    ruc?: string | null;
  } | null;
  responsable_comercial?: { id: string; nombre?: string | null } | null;
  responsable_tecnico?: { id: string; nombre?: string | null } | null;
  project_manager?: { id: string; nombre?: string | null } | null;
  estado_actual_desde?: string | null;
  estado_actual_desde_fuente?: "historial" | "updated_at" | "created_at" | "fecha_ingreso" | "desconocido";
  tiempo_en_estado_segundos?: number | null;
  sla_estado_actual?: {
    cuenta_sla: boolean;
    objetivo_horas: number | null;
    vencido: boolean;
    restante_segundos: number | null;
    excedido_segundos: number | null;
  };
};

/**
 * Máximo de ids por request en un `in.(...)`.
 *
 * Los ids viajan en la URL. Con 114 proyectos el pedido del historial pasaba
 * los 4 KB y el gateway lo cortaba; como el error se tragaba en silencio, el
 * enriquecido caía al `updated_at` del proyecto y TODAS las tarjetas mostraban
 * "Día 1" del período de post-entrega, porque cualquier edición masiva pone esa
 * fecha en hoy.
 */
const IDS_POR_LOTE = 40;

/** Ejecuta la consulta por lotes de ids y junta el resultado. */
async function enLotes<T>(
  ids: string[],
  build: (lote: string[]) => PromiseLike<{ data: unknown; error: unknown }>
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IDS_POR_LOTE) {
    const { data, error } = await build(ids.slice(i, i + IDS_POR_LOTE));
    if (error) {
      // Se avisa en el log: sin historial el tiempo en estado sale del
      // `updated_at`, que es una aproximación y no debe pasar desapercibida.
      console.error("[enrich-proyectos] historial", (error as { message?: string }).message ?? error);
      continue;
    }
    const filas = (data ?? []) as T[];
    // 1000 es el tope por defecto de PostgREST: si un lote lo alcanza, algo se
    // quedó afuera y hay que achicar el lote. Se avisa en vez de truncar callado.
    if (filas.length >= 1000) {
      console.warn("[enrich-proyectos] lote en el tope de 1000 filas; puede faltar historial");
    }
    out.push(...filas);
  }
  return out;
}

function uniq(ids: (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))];
}

function firstValidIso(
  row: Record<string, unknown>
): { value: string | null; source: ProyectoEnriquecido["estado_actual_desde_fuente"] } {
  for (const key of ["updated_at", "created_at", "fecha_ingreso"] as const) {
    const raw = row[key];
    if (typeof raw !== "string" || !raw.trim()) continue;
    const ms = Date.parse(raw);
    if (Number.isFinite(ms)) return { value: new Date(ms).toISOString(), source: key };
  }
  return { value: null, source: "desconocido" };
}

export async function enrichProyectosRows(
  sb: AppSupabaseClient,
  empresaId: string,
  rows: Record<string, unknown>[]
): Promise<ProyectoEnriquecido[]> {
  if (rows.length === 0) return [];

  const tipoIds = uniq(rows.map((r) => r.tipo_id as string | undefined));
  const estadoIds = uniq(rows.map((r) => r.estado_id as string | undefined));
  const clienteIds = uniq(rows.map((r) => r.cliente_id as string | undefined));
  const uCom = uniq(rows.map((r) => r.responsable_comercial_id as string | undefined));
  const uTec = uniq(rows.map((r) => r.responsable_tecnico_id as string | undefined));
  const uPm = uniq(rows.map((r) => r.project_manager_id as string | undefined));
  const userIds = uniq([...uCom, ...uTec, ...uPm]);
  const proyectoIds = uniq(rows.map((r) => r.id as string | undefined));

  const catalog = createServiceRoleClient();

  const [tiposR, estadosR, clientesR, usersR, historialR] = await Promise.all([
    tipoIds.length
      ? sb.from("proyecto_tipos").select("id,nombre,codigo").eq("empresa_id", empresaId).in("id", tipoIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    estadoIds.length
      ? enLotes<Record<string, unknown>>(estadoIds, (lote) =>
          sb
            .from("proyecto_estados")
            .select("id,nombre,codigo,color,tipo_sla,cuenta_sla,sla_horas_objetivo,es_estado_final")
            .eq("empresa_id", empresaId)
            .in("id", lote)
        ).then((data) => ({ data }))
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    clienteIds.length
      ? enLotes<Record<string, unknown>>(clienteIds, (lote) =>
          sb
            .from("clientes")
            .select("id,tipo_cliente,empresa,nombre_contacto,nombre,razon_social,ruc")
            .eq("empresa_id", empresaId)
            .in("id", lote)
        ).then((data) => ({ data }))
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    userIds.length
      ? enLotes<Record<string, unknown>>(userIds, (lote) =>
          catalog.from("usuarios").select("id,nombre").eq("empresa_id", empresaId).in("id", lote)
        ).then((data) => ({ data }))
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    proyectoIds.length
      ? enLotes<Record<string, unknown>>(proyectoIds, (lote) =>
          sb
            .from("proyecto_estado_historial")
            .select("proyecto_id, estado_nuevo_id, entered_at, exited_at")
            .eq("empresa_id", empresaId)
            .in("proyecto_id", lote)
            .order("entered_at", { ascending: false })
        ).then((data) => ({ data }))
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  const tiposMap = new Map(
    (tiposR.data ?? []).map((t) => {
      const row = t as { id: string };
      return [row.id, row] as const;
    })
  );
  const estadosMap = new Map(
    (estadosR.data ?? []).map((t) => {
      const row = t as { id: string };
      return [row.id, row] as const;
    })
  );
  const clientesMap = new Map(
    (clientesR.data ?? []).map((t) => {
      const row = t as { id: string };
      return [row.id, row] as const;
    })
  );
  const usersMap = new Map(
    (usersR.data ?? []).map((t) => {
      const row = t as { id: string };
      return [row.id, row] as const;
    })
  );
  const historialPorProyecto = new Map<string, Record<string, unknown>[]>();
  for (const h of historialR.data ?? []) {
    const row = h as Record<string, unknown>;
    const proyectoId = row.proyecto_id;
    if (typeof proyectoId !== "string") continue;
    const current = historialPorProyecto.get(proyectoId) ?? [];
    current.push(row);
    historialPorProyecto.set(proyectoId, current);
  }
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  return rows.map((r) => {
    const tipo_id = r.tipo_id as string | undefined;
    const estado_id = r.estado_id as string | undefined;
    const cliente_id = r.cliente_id as string | undefined;
    const rc = r.responsable_comercial_id as string | undefined;
    const rt = r.responsable_tecnico_id as string | undefined;
    const pm = r.project_manager_id as string | undefined;
    const pid = r.id as string | undefined;
    const out: ProyectoEnriquecido = { ...r };
    if (tipo_id) out.proyecto_tipo = (tiposMap.get(tipo_id) as ProyectoEnriquecido["proyecto_tipo"]) ?? null;
    if (estado_id) out.proyecto_estado = (estadosMap.get(estado_id) as ProyectoEnriquecido["proyecto_estado"]) ?? null;
    if (cliente_id) out.cliente = (clientesMap.get(cliente_id) as ProyectoEnriquecido["cliente"]) ?? null;
    if (rc) {
      const u = usersMap.get(rc) as { id: string; nombre?: string } | undefined;
      out.responsable_comercial = u ? { id: u.id, nombre: u.nombre ?? null } : { id: rc, nombre: null };
    }
    if (rt) {
      const u = usersMap.get(rt) as { id: string; nombre?: string } | undefined;
      out.responsable_tecnico = u ? { id: u.id, nombre: u.nombre ?? null } : { id: rt, nombre: null };
    }
    if (pm) {
      const u = usersMap.get(pm) as { id: string; nombre?: string } | undefined;
      out.project_manager = u ? { id: u.id, nombre: u.nombre ?? null } : { id: pm, nombre: null };
    }
    const estado = out.proyecto_estado;
    const historial = pid ? historialPorProyecto.get(pid) ?? [] : [];
    const currentHist = historial.find(
      (h) => h.estado_nuevo_id === estado_id && (h.exited_at == null || h.exited_at === "")
    ) ?? historial.find((h) => h.estado_nuevo_id === estado_id);
    const enteredRaw = currentHist?.entered_at;
    const enteredMs = typeof enteredRaw === "string" ? Date.parse(enteredRaw) : Number.NaN;
    const fallback = firstValidIso(r);
    const estadoDesde =
      Number.isFinite(enteredMs) && typeof enteredRaw === "string"
        ? { value: new Date(enteredMs).toISOString(), source: "historial" as const }
        : fallback;
    // Tiempo LABORAL en el estado, no corrido: la empresa trabaja de lunes a
    // viernes de 8 a 17 y los sábados de 8 a 12. Antes esto era `now - desde`,
    // así que un proyecto que entraba el viernes a las 17 amanecía el lunes con
    // 63 h encima y podía figurar vencido sin que nadie hubiera trabajado un
    // minuto. Ver `reloj-laboral.ts`.
    const laborMs = estadoDesde.value ? msLaborables(estadoDesde.value, nowIso) : null;
    const seconds = laborMs != null ? Math.max(0, Math.floor(laborMs / 1000)) : null;
    const cuentaSla = estado?.cuenta_sla !== false;
    const objetivoHoras =
      typeof estado?.sla_horas_objetivo === "number" && Number.isFinite(estado.sla_horas_objetivo)
        ? estado.sla_horas_objetivo
        : null;
    const objetivoSegundos = objetivoHoras != null ? objetivoHoras * 3600 : null;
    const vencido = cuentaSla && seconds != null && objetivoSegundos != null && seconds > objetivoSegundos;
    out.estado_actual_desde = estadoDesde.value;
    out.estado_actual_desde_fuente = estadoDesde.source;
    out.tiempo_en_estado_segundos = seconds;
    out.sla_estado_actual = {
      cuenta_sla: cuentaSla,
      objetivo_horas: objetivoHoras,
      vencido,
      restante_segundos:
        cuentaSla && seconds != null && objetivoSegundos != null
          ? Math.max(0, objetivoSegundos - seconds)
          : null,
      excedido_segundos:
        cuentaSla && seconds != null && objetivoSegundos != null
          ? Math.max(0, seconds - objetivoSegundos)
          : null,
    };
    return out;
  });
}
