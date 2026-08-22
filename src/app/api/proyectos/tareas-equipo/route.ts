import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { ETAPA_FINAL, type ProyectoEtapaDesarrollo } from "@/lib/proyectos/etapas-desarrollo";
import { QA_ETAPAS_ACTIVAS, type ProyectoEtapaQA } from "@/lib/proyectos/etapas-qa";
import { estadosDeTablero, esEstadoPausado, type EstadoTablero } from "@/lib/proyectos/estados-tablero";
import { msLaborables } from "@/lib/proyectos/reloj-laboral";
import { evaluarEsqueleto } from "@/lib/proyectos/esqueleto";

/**
 * Tablero "Tareas del equipo": proyectos agrupados por programador (técnico).
 *
 * Devuelve tres bloques en una sola pasada:
 *  - `activos`: proyectos no archivados que están en alguno de los estados del
 *    Kanban que le competen al técnico (ver `estados-tablero.ts`). Vienen ya
 *    divididos en subsecciones por estado dentro de cada tarjeta.
 *  - `qa`: eje independiente de la persona que revisa (`qa_responsable_id`).
 *  - `finalizados`: reporte del mes pedido — proyectos que entraron a
 *    'finalizado' dentro del rango, con el tiempo que tardaron.
 *
 * El contador de cada proyecto se expresa en milisegundos de HORARIO LABORAL
 * (lun–vie 8–17, sáb 8–12) desde que el proyecto quedó en manos del técnico,
 * descontando el tiempo pausado. La API devuelve el instante de arranque y el
 * tiempo ya acumulado; el cliente lo hace correr en vivo.
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
  estado_id: string | null;
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
  brief_data: unknown;
};

const PROYECTO_COLUMNS =
  "id, titulo, cliente_id, tipo_id, estado_id, prioridad, responsable_tecnico_id, etapa_desarrollo, etapa_desarrollo_at, etapa_finalizado_at, tecnico_asignado_at, fecha_ingreso, fecha_prometida, bloqueado, qa_responsable_id, qa_asignado_at, qa_etapa, qa_etapa_at, pausado_at, pausa_motivo, pausa_acumulada_ms, brief_data";

/**
 * Tiempo de trabajo acumulado de un proyecto, en milisegundos de horario laboral.
 *
 * Es el contador de la tarjeta: horario de la empresa desde que el proyecto
 * quedó en manos del técnico, menos lo que estuvo pausado.
 *
 * `pausa_acumulada_ms` guarda milisegundos LABORALES (lo escriben así
 * `cambiar-estado` y el PATCH de pausa), de modo que las dos magnitudes están
 * en la misma unidad y la resta es directa. Pausar un viernes a las 18 y
 * reanudar el lunes a las 8 descuenta cero, que es lo correcto: no se perdió
 * tiempo de trabajo.
 */
function msTrabajados(desde: string | null, p: ProyectoRow, hastaIso?: string | null): number | null {
  const bruto = msLaborables(desde, hastaIso ?? null);
  if (bruto == null) return null;

  const enCurso = p.pausado_at ? msLaborables(p.pausado_at, hastaIso ?? null) ?? 0 : 0;
  const previo = Number(p.pausa_acumulada_ms ?? 0);
  const acumulada = Number.isFinite(previo) && previo > 0 ? previo : 0;

  return Math.max(0, bruto - enCurso - acumulada);
}

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

    // Los estados que le competen al técnico salen de la configuración de la
    // empresa, no de una lista fija de la API: si mañana renombran una columna
    // el tablero la sigue mostrando bien.
    const { data: estadosData, error: eEstados } = await sb
      .from("proyecto_estados")
      .select("id, codigo, nombre, color, tipo_sla")
      .eq("empresa_id", empresaId)
      .eq("activo", true);

    if (eEstados) {
      return NextResponse.json(errorResponse(eEstados.message), { status: 400 });
    }

    const estadosTablero = estadosDeTablero((estadosData ?? []) as EstadoTablero[]);
    const estadosTableroIds = estadosTablero.map((e) => e.id);
    const estadoPorId = new Map(estadosTablero.map((e) => [e.id, e] as const));

    const [activosRes, qaRes, finalizadosRes] = await Promise.all([
      // Sin estados configurados no hay tablero que armar: se evita un `.in()`
      // con lista vacía, que en PostgREST trae todo.
      estadosTableroIds.length === 0
        ? Promise.resolve({ data: [] as Record<string, unknown>[], error: null })
        : sb
            .from("proyectos")
            .select(PROYECTO_COLUMNS)
            .eq("empresa_id", empresaId)
            .eq("archivado", false)
            .in("estado_id", estadosTableroIds)
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

    // El código del tipo decide si al proyecto le corre el compromiso de
    // esqueleto (sólo "web"); el nombre es lo que se muestra.
    const tipoCodigo = new Map<string, string>();
    for (const t of (tiposRes.data ?? []) as { id: string; codigo: string | null }[]) {
      tipoCodigo.set(t.id, (t.codigo ?? "").trim());
    }

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

    // --- Bloque 1: activos por programador, divididos por estado -------------
    type ActivoItem = {
      id: string;
      titulo: string;
      cliente: string;
      tipo: string;
      tipo_codigo: string;
      prioridad: string;
      estado_id: string;
      estado_codigo: string;
      estado_nombre: string;
      estado_color: string;
      /** Milisegundos de horario laboral ya acumulados al momento de responder. */
      ms_trabajados: number | null;
      /** Instante de arranque del contador; el cliente lo hace correr en vivo. */
      desde: string | null;
      fecha_prometida: string | null;
      bloqueado: boolean;
      pausado: boolean;
      pausa_motivo: string | null;
      pausado_at: string | null;
      /** Compromiso de esqueleto (sólo Proyecto Web en desarrollo). */
      esqueleto: "ok" | "por_vencer" | "vencido" | null;
      esqueleto_restante_ms: number | null;
      qa_responsable_id: string | null;
      qa_responsable_nombre: string | null;
      qa_etapa: ProyectoEtapaQA | null;
    };
    type SeccionEstado = {
      estado_id: string;
      codigo: string;
      nombre: string;
      color: string;
      cantidad: number;
      proyectos: ActivoItem[];
    };
    type GrupoActivo = {
      tecnico_id: string | null;
      tecnico_nombre: string;
      cantidad: number;
      pausados: number;
      alertas_esqueleto: number;
      secciones: SeccionEstado[];
    };

    const ahoraIso = new Date().toISOString();
    const gruposActivos = new Map<string, GrupoActivo>();

    for (const p of activos) {
      const estado = p.estado_id ? estadoPorId.get(p.estado_id) : undefined;
      // Defensivo: la consulta ya filtra por estos estados, así que no debería
      // pasar. Si pasara, se descarta en vez de armar una sección fantasma.
      if (!estado) continue;

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
          alertas_esqueleto: 0,
          // Todas las subsecciones nacen vacías y en orden, para que las
          // tarjetas de dos técnicos distintos se lean igual.
          secciones: estadosTablero.map((e) => ({
            estado_id: e.id,
            codigo: e.codigo ?? "",
            nombre: (e.nombre ?? "").trim() || e.codigo || "—",
            color: e.color ?? "#94a3b8",
            cantidad: 0,
            proyectos: [],
          })),
        };
        gruposActivos.set(key, g);
      }

      const desdeAsignacion = inicioContador(p);
      const pausado = esEstadoPausado(estado) || (typeof p.pausado_at === "string" && !!p.pausado_at);
      const codigoTipo = p.tipo_id ? tipoCodigo.get(p.tipo_id) ?? "" : "";

      const ev = evaluarEsqueleto({
        tipoCodigo: codigoTipo,
        estadoCodigo: estado.codigo,
        desde: desdeAsignacion,
        pausado,
        briefData: p.brief_data,
        ahoraIso,
      });

      g.cantidad += 1;
      if (pausado) g.pausados += 1;
      if (ev.aplica && ev.estado !== "ok") g.alertas_esqueleto += 1;

      const item: ActivoItem = {
        id: p.id,
        titulo: (p.titulo ?? "").trim() || "(sin título)",
        cliente: (p.cliente_id ? clienteNombre.get(p.cliente_id) ?? "" : "") || (p.titulo ?? "").trim() || "—",
        tipo: p.tipo_id ? tipoNombre.get(p.tipo_id) ?? "" : "",
        tipo_codigo: codigoTipo,
        prioridad: p.prioridad ?? "normal",
        estado_id: estado.id,
        estado_codigo: estado.codigo ?? "",
        estado_nombre: (estado.nombre ?? "").trim() || estado.codigo || "—",
        estado_color: estado.color ?? "#94a3b8",
        ms_trabajados: msTrabajados(desdeAsignacion, p, ahoraIso),
        desde: desdeAsignacion,
        fecha_prometida: p.fecha_prometida,
        bloqueado: p.bloqueado === true,
        pausado,
        pausa_motivo: p.pausa_motivo,
        pausado_at: p.pausado_at,
        esqueleto: ev.aplica ? ev.estado : null,
        esqueleto_restante_ms: ev.restanteMs,
        qa_responsable_id: p.qa_responsable_id,
        qa_responsable_nombre: p.qa_responsable_id
          ? tecnicoNombre.get(p.qa_responsable_id) ?? null
          : null,
        qa_etapa: p.qa_etapa,
      };

      const seccion = g.secciones.find((s) => s.estado_id === estado.id);
      if (seccion) {
        seccion.cantidad += 1;
        seccion.proyectos.push(item);
      }
    }

    // Dentro de cada subsección, primero lo que más tiempo lleva: es lo que se
    // mira en el pase diario. El aviso de esqueleto gana sobre eso, porque tiene
    // una fecha comprometida encima.
    const ordenarActivos = (a: ActivoItem, b: ActivoItem) => {
      const pesoA = a.esqueleto === "vencido" ? 2 : a.esqueleto === "por_vencer" ? 1 : 0;
      const pesoB = b.esqueleto === "vencido" ? 2 : b.esqueleto === "por_vencer" ? 1 : 0;
      if (pesoA !== pesoB) return pesoB - pesoA;
      return (b.ms_trabajados ?? -1) - (a.ms_trabajados ?? -1);
    };

    const activosPorProgramador = Array.from(gruposActivos.values())
      .map((g) => ({
        ...g,
        secciones: g.secciones.map((s) => ({
          ...s,
          proyectos: s.proyectos.slice().sort(ordenarActivos),
        })),
      }))
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
      ms_trabajados: number | null;
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
        ms_trabajados: msTrabajados(p.qa_asignado_at, p, ahoraIso),
        desde: p.qa_asignado_at,
        fecha_prometida: p.fecha_prometida,
        pausado: typeof p.pausado_at === "string" && !!p.pausado_at,
        pausa_motivo: p.pausa_motivo,
        tecnico_nombre: p.responsable_tecnico_id
          ? tecnicoNombre.get(p.responsable_tecnico_id) ?? null
          : null,
      });
    }

    // La gente de QA tiene tarjeta incluso sin proyectos asignados. Si sólo se
    // derivara de los proyectos, una QA recién incorporada sería invisible en el
    // tablero justo cuando hay que empezar a asignarle trabajo.
    {
      const catalog = createServiceRoleClient();
      const { data: qaUsuarios } = await catalog
        .from("usuarios")
        .select("id, nombre, email")
        .eq("empresa_id", empresaId)
        .eq("es_qa", true)
        .ilike("estado", "activo");

      for (const u of (qaUsuarios ?? []) as { id: string; nombre: string | null; email: string | null }[]) {
        if (gruposQa.has(u.id)) continue;
        gruposQa.set(u.id, {
          qa_id: u.id,
          qa_nombre: (u.nombre ?? "").trim() || (u.email ?? "").trim() || "QA sin nombre",
          cantidad: 0,
          proyectos: [],
        });
      }
    }

    const qaPorResponsable = Array.from(gruposQa.values())
      .map((g) => ({
        ...g,
        proyectos: g.proyectos
          .slice()
          .sort((a, b) => (b.ms_trabajados ?? -1) - (a.ms_trabajados ?? -1)),
      }))
      .sort((a, b) => a.qa_nombre.localeCompare(b.qa_nombre));

    // --- Bloque 2: reporte de finalizados del mes ----------------------------
    type FinalizadoItem = {
      id: string;
      titulo: string;
      cliente: string;
      tipo: string;
      finalizado_at: string;
      ms_trabajados: number | null;
    };
    type GrupoFinalizado = {
      tecnico_id: string | null;
      tecnico_nombre: string;
      cantidad: number;
      promedio_ms: number | null;
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
          promedio_ms: null,
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
        ms_trabajados: msTrabajados(desdeAsignacion, p, p.etapa_finalizado_at),
      });
    }

    const finalizadosPorProgramador = Array.from(gruposFin.values())
      .map((g) => {
        const medidos = g.proyectos
          .map((p) => p.ms_trabajados)
          .filter((d): d is number => typeof d === "number");
        return {
          ...g,
          promedio_ms:
            medidos.length > 0
              ? Math.round(medidos.reduce((a, b) => a + b, 0) / medidos.length)
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
        // Instante en que se calcularon los contadores. El cliente le suma el
        // horario laboral transcurrido desde acá para hacerlos correr en vivo,
        // en vez de re-derivar las pausas del lado del navegador.
        generado_at: ahoraIso,
        // Vocabulario del selector de estado de cada fila: exactamente las
        // columnas del Kanban que le competen al técnico, en su orden.
        estados_tablero: estadosTablero.map((e) => ({
          id: e.id,
          codigo: e.codigo ?? "",
          nombre: (e.nombre ?? "").trim() || e.codigo || "—",
          color: e.color ?? "#94a3b8",
        })),
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
