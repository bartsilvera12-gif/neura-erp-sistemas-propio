import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import {
  ETAPAS_ACTIVAS,
  ETAPA_FINAL,
  diasNetos,
  diasTranscurridos,
  type ProyectoEtapaDesarrollo,
} from "@/lib/proyectos/etapas-desarrollo";
import { QA_ETAPAS_ACTIVAS, type ProyectoEtapaQA } from "@/lib/proyectos/etapas-qa";

/**
 * Tablero "Tareas del equipo": proyectos agrupados por programador (técnico).
 *
 * Devuelve dos bloques en una sola pasada:
 *  - `activos`: proyectos no archivados cuya `etapa_desarrollo` no es 'finalizado'.
 *    El contador de días corre desde `tecnico_asignado_at`.
 *  - `finalizados`: reporte del mes pedido — proyectos que entraron a 'finalizado'
 *    dentro del rango, con el tiempo que tardaron desde la asignación.
 *
 * Query param:
 *   ?mes=YYYY-MM (default: mes actual)
 */

const SIN_ASIGNAR = "__SIN_ASIGNAR__";

type ProyectoRow = {
  id: string;
  titulo: string | null;
  cliente_id: string | null;
  tipo_id: string | null;
  prioridad: string | null;
  responsable_tecnico_id: string | null;
  etapa_desarrollo: ProyectoEtapaDesarrollo | null;
  etapa_desarrollo_at: string | null;
  etapa_finalizado_at: string | null;
  tecnico_asignado_at: string | null;
  fecha_ingreso: string | null;
  fecha_prometida: string | null;
  bloqueado: boolean | null;
  qa_responsable_id: string | null;
  qa_asignado_at: string | null;
  qa_etapa: ProyectoEtapaQA | null;
  qa_etapa_at: string | null;
  pausado_at: string | null;
  pausa_motivo: string | null;
  pausa_acumulada_ms: number | null;
};

const PROYECTO_COLUMNS =
  "id, titulo, cliente_id, tipo_id, prioridad, responsable_tecnico_id, etapa_desarrollo, etapa_desarrollo_at, etapa_finalizado_at, tecnico_asignado_at, fecha_ingreso, fecha_prometida, bloqueado, qa_responsable_id, qa_asignado_at, qa_etapa, qa_etapa_at, pausado_at, pausa_motivo, pausa_acumulada_ms";

export async function GET(request: Request) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  try {
    const url = new URL(request.url);
    const mesParam = (url.searchParams.get("mes") ?? "").trim();
    const now = new Date();
    const mesMatch = /^(\d{4})-(\d{2})$/.exec(mesParam);
    const year = mesMatch ? Number(mesMatch[1]) : now.getUTCFullYear();
    const month = mesMatch ? Number(mesMatch[2]) - 1 : now.getUTCMonth();
    const desde = new Date(Date.UTC(year, month, 1)).toISOString();
    const hasta = new Date(Date.UTC(year, month + 1, 1)).toISOString();
    const mesLabel = `${year}-${String(month + 1).padStart(2, "0")}`;

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const empresaId = auth.empresaId;

    const [activosRes, qaRes, finalizadosRes] = await Promise.all([
      sb
        .from("proyectos")
        .select(PROYECTO_COLUMNS)
        .eq("empresa_id", empresaId)
        .eq("archivado", false)
        .in("etapa_desarrollo", ETAPAS_ACTIVAS)
        .order("tecnico_asignado_at", { ascending: true, nullsFirst: false }),
      // Bloque de QA: eje independiente del de desarrollo. Un proyecto puede
      // estar acá y en el bloque del programador a la vez (aparece en las dos
      // tarjetas), o sólo acá si el programador ya lo dio por finalizado.
      sb
        .from("proyectos")
        .select(PROYECTO_COLUMNS)
        .eq("empresa_id", empresaId)
        .eq("archivado", false)
        .not("qa_responsable_id", "is", null)
        .in("qa_etapa", QA_ETAPAS_ACTIVAS)
        .order("qa_asignado_at", { ascending: true, nullsFirst: false }),
      sb
        .from("proyectos")
        .select(PROYECTO_COLUMNS)
        .eq("empresa_id", empresaId)
        .eq("etapa_desarrollo", ETAPA_FINAL)
        .not("etapa_finalizado_at", "is", null)
        .gte("etapa_finalizado_at", desde)
        .lt("etapa_finalizado_at", hasta)
        .order("etapa_finalizado_at", { ascending: true }),
    ]);

    if (activosRes.error) {
      return NextResponse.json(errorResponse(activosRes.error.message), { status: 400 });
    }
    if (qaRes.error) {
      return NextResponse.json(errorResponse(qaRes.error.message), { status: 400 });
    }
    if (finalizadosRes.error) {
      return NextResponse.json(errorResponse(finalizadosRes.error.message), { status: 400 });
    }

    const activos = (activosRes.data ?? []) as ProyectoRow[];
    const enQa = (qaRes.data ?? []) as ProyectoRow[];
    const finalizados = (finalizadosRes.data ?? []) as ProyectoRow[];
    const todos = [...activos, ...enQa, ...finalizados];

    // --- Hidratación de nombres (clientes, tipos, técnicos) -------------------
    const clienteIds = uniq(todos.map((p) => p.cliente_id));
    const tipoIds = uniq(todos.map((p) => p.tipo_id));
    const tecnicoIds = uniq([
      ...todos.map((p) => p.responsable_tecnico_id),
      ...todos.map((p) => p.qa_responsable_id),
    ]);

    const [clientesRes, tiposRes] = await Promise.all([
      clienteIds.length
        ? sb.from("clientes").select("id, empresa, nombre_contacto").eq("empresa_id", empresaId).in("id", clienteIds)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      tipoIds.length
        ? sb.from("proyecto_tipos").select("id, nombre, codigo").eq("empresa_id", empresaId).in("id", tipoIds)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    ]);

    const clienteNombre = new Map<string, string>();
    for (const c of (clientesRes.data ?? []) as {
      id: string;
      empresa: string | null;
      nombre_contacto: string | null;
    }[]) {
      clienteNombre.set(c.id, (c.empresa ?? "").trim() || (c.nombre_contacto ?? "").trim() || "");
    }

    const tipoNombre = new Map<string, string>();
    for (const t of (tiposRes.data ?? []) as { id: string; nombre: string | null }[]) {
      tipoNombre.set(t.id, (t.nombre ?? "").trim());
    }

    const tecnicoNombre = new Map<string, string>();
    if (tecnicoIds.length > 0) {
      const catalog = createServiceRoleClient();
      const { data: usuarios } = await catalog
        .from("usuarios")
        .select("id, nombre, email")
        .eq("empresa_id", empresaId)
        .in("id", tecnicoIds);
      for (const u of (usuarios ?? []) as { id: string; nombre: string | null; email: string | null }[]) {
        tecnicoNombre.set(u.id, (u.nombre ?? "").trim() || (u.email ?? "").trim() || "Técnico sin nombre");
      }
    }

    // --- Bloque 1: activos por programador -----------------------------------
    type ActivoItem = {
      id: string;
      titulo: string;
      cliente: string;
      tipo: string;
      prioridad: string;
      etapa_desarrollo: ProyectoEtapaDesarrollo;
      dias: number | null;
      dias_en_etapa: number | null;
      desde: string | null;
      fecha_prometida: string | null;
      bloqueado: boolean;
      pausado: boolean;
      pausa_motivo: string | null;
      pausado_at: string | null;
      qa_responsable_id: string | null;
      qa_responsable_nombre: string | null;
      qa_etapa: ProyectoEtapaQA | null;
    };
    type GrupoActivo = {
      tecnico_id: string | null;
      tecnico_nombre: string;
      cantidad: number;
      pausados: number;
      proyectos: ActivoItem[];
    };

    const gruposActivos = new Map<string, GrupoActivo>();
    for (const p of activos) {
      const key = p.responsable_tecnico_id ?? SIN_ASIGNAR;
      let g = gruposActivos.get(key);
      if (!g) {
        g = {
          tecnico_id: p.responsable_tecnico_id,
          tecnico_nombre: p.responsable_tecnico_id
            ? tecnicoNombre.get(p.responsable_tecnico_id) ?? "Técnico sin nombre"
            : "Sin asignar",
          cantidad: 0,
          pausados: 0,
          proyectos: [],
        };
        gruposActivos.set(key, g);
      }
      const desdeAsignacion = inicioContador(p);
      const pausado = typeof p.pausado_at === "string" && !!p.pausado_at;
      g.cantidad += 1;
      if (pausado) g.pausados += 1;
      g.proyectos.push({
        id: p.id,
        titulo: (p.titulo ?? "").trim() || "(sin título)",
        cliente: (p.cliente_id ? clienteNombre.get(p.cliente_id) ?? "" : "") || (p.titulo ?? "").trim() || "—",
        tipo: p.tipo_id ? tipoNombre.get(p.tipo_id) ?? "" : "",
        prioridad: p.prioridad ?? "normal",
        etapa_desarrollo: p.etapa_desarrollo ?? "en_desarrollo",
        // El contador descuenta el tiempo pausado: mide trabajo, no calendario.
        dias: diasNetos(desdeAsignacion, p),
        dias_en_etapa: diasTranscurridos(p.etapa_desarrollo_at),
        desde: desdeAsignacion,
        fecha_prometida: p.fecha_prometida,
        bloqueado: p.bloqueado === true,
        pausado,
        pausa_motivo: p.pausa_motivo,
        pausado_at: p.pausado_at,
        qa_responsable_id: p.qa_responsable_id,
        qa_responsable_nombre: p.qa_responsable_id
          ? tecnicoNombre.get(p.qa_responsable_id) ?? null
          : null,
        qa_etapa: p.qa_etapa,
      });
    }

    const ordenarActivos = (a: ActivoItem, b: ActivoItem) => {
      // Los pausados al fondo: no requieren acción del programador hoy.
      if (a.pausado !== b.pausado) return a.pausado ? 1 : -1;
      // Y dentro de cada bloque, los que llevan más días arriba: es lo primero
      // que se mira en el pase diario.
      return (b.dias ?? -1) - (a.dias ?? -1);
    };

    const activosPorProgramador = Array.from(gruposActivos.values())
      .map((g) => ({ ...g, proyectos: g.proyectos.slice().sort(ordenarActivos) }))
      .sort((a, b) => {
        if (a.tecnico_id == null && b.tecnico_id != null) return 1;
        if (a.tecnico_id != null && b.tecnico_id == null) return -1;
        return a.tecnico_nombre.localeCompare(b.tecnico_nombre);
      });

    // --- Bloque 1b: QA por responsable ---------------------------------------
    // Mismo formato de item que el bloque de desarrollo para que el cliente
    // reuse la fila; lo que cambia es el eje: etapa y contador son los de QA.
    type QAItem = {
      id: string;
      titulo: string;
      cliente: string;
      tipo: string;
      qa_etapa: ProyectoEtapaQA;
      etapa_desarrollo: ProyectoEtapaDesarrollo;
      dias: number | null;
      desde: string | null;
      fecha_prometida: string | null;
      pausado: boolean;
      pausa_motivo: string | null;
      tecnico_nombre: string | null;
    };
    type GrupoQA = {
      qa_id: string;
      qa_nombre: string;
      cantidad: number;
      proyectos: QAItem[];
    };

    const gruposQa = new Map<string, GrupoQA>();
    for (const p of enQa) {
      const qaId = p.qa_responsable_id;
      if (!qaId) continue;
      let g = gruposQa.get(qaId);
      if (!g) {
        g = {
          qa_id: qaId,
          qa_nombre: tecnicoNombre.get(qaId) ?? "QA sin nombre",
          cantidad: 0,
          proyectos: [],
        };
        gruposQa.set(qaId, g);
      }
      g.cantidad += 1;
      g.proyectos.push({
        id: p.id,
        titulo: (p.titulo ?? "").trim() || "(sin título)",
        cliente: (p.cliente_id ? clienteNombre.get(p.cliente_id) ?? "" : "") || (p.titulo ?? "").trim() || "—",
        tipo: p.tipo_id ? tipoNombre.get(p.tipo_id) ?? "" : "",
        qa_etapa: p.qa_etapa ?? "revision_pre_entrega",
        etapa_desarrollo: p.etapa_desarrollo ?? "en_desarrollo",
        dias: diasNetos(p.qa_asignado_at, p),
        desde: p.qa_asignado_at,
        fecha_prometida: p.fecha_prometida,
        pausado: typeof p.pausado_at === "string" && !!p.pausado_at,
        pausa_motivo: p.pausa_motivo,
        tecnico_nombre: p.responsable_tecnico_id
          ? tecnicoNombre.get(p.responsable_tecnico_id) ?? null
          : null,
      });
    }

    const qaPorResponsable = Array.from(gruposQa.values())
      .map((g) => ({
        ...g,
        proyectos: g.proyectos.slice().sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1)),
      }))
      .sort((a, b) => a.qa_nombre.localeCompare(b.qa_nombre));

    // --- Bloque 2: reporte de finalizados del mes ----------------------------
    type FinalizadoItem = {
      id: string;
      titulo: string;
      cliente: string;
      tipo: string;
      finalizado_at: string;
      dias_tardados: number | null;
    };
    type GrupoFinalizado = {
      tecnico_id: string | null;
      tecnico_nombre: string;
      cantidad: number;
      promedio_dias: number | null;
      proyectos: FinalizadoItem[];
    };

    const gruposFin = new Map<string, GrupoFinalizado>();
    for (const p of finalizados) {
      const key = p.responsable_tecnico_id ?? SIN_ASIGNAR;
      let g = gruposFin.get(key);
      if (!g) {
        g = {
          tecnico_id: p.responsable_tecnico_id,
          tecnico_nombre: p.responsable_tecnico_id
            ? tecnicoNombre.get(p.responsable_tecnico_id) ?? "Técnico sin nombre"
            : "Sin asignar",
          cantidad: 0,
          promedio_dias: null,
          proyectos: [],
        };
        gruposFin.set(key, g);
      }
      const desdeAsignacion = inicioContador(p);
      g.cantidad += 1;
      g.proyectos.push({
        id: p.id,
        titulo: (p.titulo ?? "").trim() || "(sin título)",
        cliente: (p.cliente_id ? clienteNombre.get(p.cliente_id) ?? "" : "") || (p.titulo ?? "").trim() || "—",
        tipo: p.tipo_id ? tipoNombre.get(p.tipo_id) ?? "" : "",
        finalizado_at: p.etapa_finalizado_at ?? "",
        dias_tardados: diasNetos(desdeAsignacion, p, p.etapa_finalizado_at),
      });
    }

    const finalizadosPorProgramador = Array.from(gruposFin.values())
      .map((g) => {
        const conDias = g.proyectos
          .map((p) => p.dias_tardados)
          .filter((d): d is number => typeof d === "number");
        return {
          ...g,
          promedio_dias:
            conDias.length > 0
              ? Math.round((conDias.reduce((a, b) => a + b, 0) / conDias.length) * 10) / 10
              : null,
        };
      })
      .sort((a, b) => {
        if (a.tecnico_id == null && b.tecnico_id != null) return 1;
        if (a.tecnico_id != null && b.tecnico_id == null) return -1;
        return b.cantidad - a.cantidad || a.tecnico_nombre.localeCompare(b.tecnico_nombre);
      });

    return NextResponse.json(
      successResponse({
        mes: mesLabel,
        desde,
        hasta,
        activos_total: activos.length,
        activos_por_programador: activosPorProgramador,
        qa_total: enQa.length,
        qa_por_responsable: qaPorResponsable,
        finalizados_total: finalizados.length,
        finalizados_por_programador: finalizadosPorProgramador,
      })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * Inicio del contador de días. Sin programador asignado no hay nada que contar:
 * devuelve `null` y la fila muestra "—" en vez de acumular días desde el alta.
 *
 * Para los proyectos que ya tenían técnico antes de esta funcionalidad no existe
 * registro de cuándo se asignó, así que se cae a `fecha_ingreso` (el backfill de
 * la migración hizo lo mismo). Es corregible a mano desde el tablero.
 */
function inicioContador(p: ProyectoRow): string | null {
  if (!p.responsable_tecnico_id) return null;
  return p.tecnico_asignado_at ?? p.fecha_ingreso;
}

function uniq(ids: (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((v): v is string => typeof v === "string" && v.length > 0))];
}
