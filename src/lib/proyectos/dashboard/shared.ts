import "server-only";

/**
 * Dataset y métricas comunes a los dos dashboards de Proyectos.
 *
 * Regla de la casa: TODO sale del módulo Proyectos (`proyectos`,
 * `proyecto_estados`, `proyecto_estado_historial`, `proyecto_tipos`,
 * `proyecto_tareas`, `proyecto_comentarios`) y del catálogo de nombres. No hay
 * una fuente paralela de SLA/SLV.
 *
 * Se carga UNA vez y se agrega en memoria. Nada de una query por proyecto, por
 * técnico o por KPI: son ocho consultas fijas, tenga la empresa 50 proyectos o
 * 5.000.
 */

import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { msLaborables, MS_JORNADA } from "@/lib/proyectos/reloj-laboral";
import {
  CODIGOS_LISTO_ENTREGAR,
  CODIGOS_QA,
  CODIGOS_RESPONSABILIDAD_TECNICA,
  CODIGO_ENTREGADO,
  DIAS_VENCE_PRONTO,
  MS_SIN_MOVIMIENTO,
  SLV_OBJETIVOS_DEFAULT,
  SLV_OBJETIVO_POR_TIPO,
  WIP_LIMITE_DEFAULT,
  type BloqueoTipo,
} from "./config";
import { consumoPct, nivelSlv, type NivelSlv } from "./semaforo";
import { agruparHistorial, slvTecnicoDeProyecto, type SegmentoHistorial } from "./technical-slv";
import { qaDeProyecto, type QaProyecto } from "./qa-metrics";
import { motivo, scorePrioridad, type Motivo } from "./priority-score";

const PAGINA = 1000;
/** Techo de seguridad: 50k filas de historial son ~5.000 proyectos con 10 transiciones. */
const MAX_FILAS = 50_000;
/** Ventana de actividad reciente. Sólo sirve para decidir "sin movimiento". */
const DIAS_ACTIVIDAD = 45;

export type EstadoRow = {
  id: string;
  codigo: string | null;
  nombre: string | null;
  color: string | null;
  tipo_sla: string | null;
  es_estado_final: boolean | null;
  sla_horas_objetivo: number | null;
  sort_order: number | null;
};

export type Filtros = {
  desde: string | null;
  hasta: string | null;
  tipoId: string | null;
  estadoId: string | null;
  tecnicoId: string | null;
  /** PM cuya cartera se mira ("Mis proyectos"). */
  pmId: string | null;
};

export type ProyectoMetrica = {
  id: string;
  titulo: string;
  cliente_id: string | null;
  cliente: string;
  estado_id: string | null;
  estado_nombre: string;
  estado_codigo: string | null;
  estado_color: string;
  tipo_id: string | null;
  tipo_nombre: string;
  responsable_tecnico_id: string | null;
  tecnico: string;
  responsable_comercial_id: string | null;
  project_manager_id: string | null;
  fecha_ingreso: string | null;
  fecha_prometida: string | null;
  fecha_entrega: string | null;
  /** Días hasta la fecha prometida. Negativo = vencido. `null` = sin fecha. */
  dias_restantes: number | null;
  entregado: boolean;
  cancelado: boolean;
  entregado_a_tiempo: boolean | null;
  /** Tiempo LABORAL en el estado actual. */
  tiempo_en_estado_ms: number | null;
  estado_desde: string | null;
  bloqueado: boolean;
  bloqueo_tipo: BloqueoTipo | null;
  bloqueo_motivo: string | null;
  espera_cliente: boolean;
  en_qa: boolean;
  listo_entregar: boolean;
  responsabilidad_tecnica: boolean;
  estancado: boolean;
  slv_consumido_ms: number;
  slv_objetivo_horas: number | null;
  slv_consumo_pct: number | null;
  slv_nivel: NivelSlv | null;
  slv_atribucion_confiable: boolean;
  slv_por_tecnico: Map<string, number>;
  qa: QaProyecto;
  ultima_actividad_at: string | null;
  sin_movimiento_ms: number | null;
  sin_movimiento: boolean;
  motivos: Motivo[];
  score: number;
  /** Lead time laboral: ingreso -> primera entrega. `null` si no entregó. */
  lead_time_ms: number | null;
};

export type Dataset = {
  refMs: number;
  estados: EstadoRow[];
  tipos: { id: string; nombre: string; codigo: string | null }[];
  proyectos: ProyectoMetrica[];
  /** Técnicos con asignación real, SIN aplicar los filtros de pantalla. */
  tecnicosOpciones: { id: string; nombre: string }[];
  wipLimite: number;
  nombreUsuario: (id: string) => string;
  /** Tiempo laboral acumulado por estado, sólo de segmentos cerrados. */
  msPorEstado: Map<string, { total: number; n: number }>;
  atribucionParcial: boolean;
};

function nombreDe(map: Map<string, string>, id: string | null | undefined): string {
  if (typeof id !== "string" || !id) return "—";
  return map.get(id) ?? "—";
}

/** Trae una tabla completa en páginas de 1000 (el tope de PostgREST). */
async function traerTodo<T>(
  build: (desde: number, hasta: number) => PromiseLike<{ data: unknown; error: unknown }>
): Promise<T[]> {
  const out: T[] = [];
  for (let desde = 0; desde < MAX_FILAS; desde += PAGINA) {
    const { data, error } = await build(desde, desde + PAGINA - 1);
    if (error) throw new Error(String((error as { message?: string }).message ?? error));
    const filas = (data ?? []) as T[];
    out.push(...filas);
    if (filas.length < PAGINA) break;
  }
  return out;
}

export async function cargarDataset(
  sb: AppSupabaseClient,
  empresaId: string,
  filtros: Filtros
): Promise<Dataset> {
  const hoyIso = new Date().toISOString().slice(0, 10);
  const hasta = filtros.hasta ?? hoyIso;
  const refMs = hasta === hoyIso ? Date.now() : new Date(`${hasta}T23:59:59`).getTime();
  const refIso = new Date(refMs).toISOString();
  const catalogo = createServiceRoleClient();

  const [estadosR, tiposR, objetivosR] = await Promise.all([
    sb
      .from("proyecto_estados")
      .select("id, codigo, nombre, color, tipo_sla, es_estado_final, sla_horas_objetivo, sort_order")
      .eq("empresa_id", empresaId)
      .order("sort_order", { ascending: true }),
    sb.from("proyecto_tipos").select("id, nombre, codigo, config").eq("empresa_id", empresaId),
    sb
      .from("proyecto_slv_objetivos")
      .select("id, codigo, nombre, horas")
      .eq("empresa_id", empresaId)
      .eq("activo", true),
  ]);

  const estados = ((estadosR.data ?? []) as EstadoRow[]).filter((e) => !!e.id);
  const estadoById = new Map(estados.map((e) => [e.id, e]));
  const setDe = (codigos: readonly string[]) =>
    new Set(estados.filter((e) => codigos.includes(e.codigo ?? "")).map((e) => e.id));

  const idsTecnicos = setDe(CODIGOS_RESPONSABILIDAD_TECNICA);
  const idsQa = setDe(CODIGOS_QA);
  const idsListo = setDe(CODIGOS_LISTO_ENTREGAR);
  const idsCliente = new Set(estados.filter((e) => e.tipo_sla === "cliente").map((e) => e.id));
  const idsPausado = new Set(estados.filter((e) => e.tipo_sla === "pausado").map((e) => e.id));
  const idsFinal = new Set(estados.filter((e) => e.es_estado_final === true).map((e) => e.id));
  const idEntregado = estados.find((e) => e.codigo === CODIGO_ENTREGADO)?.id ?? null;

  const esTecnico = (id: string) => idsTecnicos.has(id);
  const esQa = (id: string) => idsQa.has(id);

  // Objetivos de SLV: catálogo de la empresa, con los valores de referencia
  // como red de contención si la migración todavía no sembró nada.
  type ObjetivoRow = { id: string; codigo: string; nombre: string; horas: number };
  const objetivos = (objetivosR.data ?? []) as ObjetivoRow[];
  const objetivoPorId = new Map(objetivos.map((o) => [o.id, Number(o.horas)]));
  const objetivoPorCodigo = new Map(objetivos.map((o) => [o.codigo, Number(o.horas)]));
  for (const d of SLV_OBJETIVOS_DEFAULT) {
    if (!objetivoPorCodigo.has(d.codigo)) objetivoPorCodigo.set(d.codigo, d.horas);
  }

  type TipoRow = { id: string; nombre: string | null; codigo: string | null; config: unknown };
  const tiposRows = (tiposR.data ?? []) as TipoRow[];
  const tipos = tiposRows.map((t) => ({ id: t.id, nombre: t.nombre ?? "—", codigo: t.codigo }));
  const tipoNombre = new Map(tipos.map((t) => [t.id, t.nombre]));
  /** Horas objetivo del TIPO: primero su `config`, si no el mapa por código. */
  const objetivoDeTipo = new Map<string, number | null>();
  for (const t of tiposRows) {
    const cfg = (t.config && typeof t.config === "object" ? t.config : {}) as Record<string, unknown>;
    const horas = Number(cfg.slv_objetivo_horas);
    if (Number.isFinite(horas) && horas > 0) {
      objetivoDeTipo.set(t.id, horas);
      continue;
    }
    const cod =
      (typeof cfg.slv_objetivo_codigo === "string" ? cfg.slv_objetivo_codigo : null) ??
      SLV_OBJETIVO_POR_TIPO[(t.codigo ?? "").toLowerCase()] ??
      null;
    objetivoDeTipo.set(t.id, cod ? objetivoPorCodigo.get(cod) ?? null : null);
  }

  // ---- Proyectos (con los filtros de pantalla) -----------------------------
  //
  // `bloqueo_tipo`, `slv_objetivo_id` y `project_manager_id` los agregan las
  // migraciones de los dashboards. Si el deploy del código llega antes que la
  // migración, se pide el set de columnas viejo en vez de romper la pantalla
  // entera: sin esos campos el dashboard sigue siendo correcto, sólo pierde la
  // clasificación del bloqueo, el objetivo por proyecto (que cae al del tipo) y
  // el PM propio del proyecto (que cae al de su cliente).
  const COLUMNAS_BASE =
    "id, titulo, cliente_id, estado_id, tipo_id, responsable_comercial_id, responsable_tecnico_id, fecha_ingreso, fecha_prometida, fecha_entrega, primera_entrega_at, bloqueado, bloqueo_motivo, created_at";
  const COLUMNAS_NUEVAS = `${COLUMNAS_BASE}, bloqueo_tipo, slv_objetivo_id, project_manager_id`;

  const pedirProyectos = (columnas: string) =>
    traerTodo<Record<string, unknown>>((a, b) => {
      let q = sb.from("proyectos").select(columnas).eq("empresa_id", empresaId).eq("archivado", false);
      if (filtros.tipoId) q = q.eq("tipo_id", filtros.tipoId);
      if (filtros.estadoId) q = q.eq("estado_id", filtros.estadoId);
      if (filtros.tecnicoId) q = q.eq("responsable_tecnico_id", filtros.tecnicoId);
      if (filtros.desde) q = q.gte("fecha_ingreso", `${filtros.desde}T00:00:00`);
      if (hasta !== hoyIso) q = q.lte("fecha_ingreso", `${hasta}T23:59:59`);
      return q.order("fecha_ingreso", { ascending: false }).range(a, b);
    });

  const proyectosRows = await pedirProyectos(COLUMNAS_NUEVAS).catch(() => pedirProyectos(COLUMNAS_BASE));

  const ids = proyectosRows.map((p) => String(p.id));
  const clienteIds = [
    ...new Set(proyectosRows.map((p) => p.cliente_id).filter((x): x is string => typeof x === "string")),
  ];
  const desdeActividad = new Date(Date.now() - DIAS_ACTIVIDAD * 86400000).toISOString();

  const [historial, clientesR, tareas, comentarios, asignaciones] = await Promise.all([
    ids.length
      ? traerTodo<SegmentoHistorial>((a, b) =>
          sb
            .from("proyecto_estado_historial")
            .select("proyecto_id, estado_nuevo_id, entered_at, exited_at, responsable_tecnico_id, metadata")
            .eq("empresa_id", empresaId)
            .in("proyecto_id", ids)
            .order("entered_at", { ascending: true })
            .range(a, b)
        )
      : Promise.resolve([] as SegmentoHistorial[]),
    clienteIds.length
      ? sb
          .from("clientes")
          .select("id, empresa, nombre_contacto, project_manager_id")
          .eq("empresa_id", empresaId)
          .in("id", clienteIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    ids.length
      ? traerTodo<{ proyecto_id: string; updated_at: string }>((a, b) =>
          sb
            .from("proyecto_tareas")
            .select("proyecto_id, updated_at")
            .eq("empresa_id", empresaId)
            .in("proyecto_id", ids)
            .gte("updated_at", desdeActividad)
            .range(a, b)
        )
      : Promise.resolve([] as { proyecto_id: string; updated_at: string }[]),
    ids.length
      ? traerTodo<{ proyecto_id: string; created_at: string }>((a, b) =>
          sb
            .from("proyecto_comentarios")
            .select("proyecto_id, created_at")
            .eq("empresa_id", empresaId)
            .in("proyecto_id", ids)
            .gte("created_at", desdeActividad)
            .range(a, b)
        )
      : Promise.resolve([] as { proyecto_id: string; created_at: string }[]),
    // Sin filtros: alimenta el selector de técnicos para que no se achique al filtrar.
    sb
      .from("proyectos")
      .select("responsable_tecnico_id")
      .eq("empresa_id", empresaId)
      .eq("archivado", false)
      .limit(5000),
  ]);

  const usuarioIds = [
    ...new Set(
      [
        ...proyectosRows.map((p) => p.responsable_tecnico_id),
        ...proyectosRows.map((p) => p.responsable_comercial_id),
        ...((asignaciones.data ?? []) as { responsable_tecnico_id: string | null }[]).map(
          (a) => a.responsable_tecnico_id
        ),
      ].filter((x): x is string => typeof x === "string" && x.length > 0)
    ),
  ];
  const usuariosR = usuarioIds.length
    ? await catalogo.from("usuarios").select("id, nombre").eq("empresa_id", empresaId).in("id", usuarioIds)
    : { data: [] as { id: string; nombre: string | null }[] };
  const nombres = new Map(
    ((usuariosR.data ?? []) as { id: string; nombre: string | null }[]).map((u) => [u.id, u.nombre ?? "—"])
  );

  const clientes = new Map(
    ((clientesR.data ?? []) as Record<string, unknown>[]).map((c) => [
      String(c.id),
      {
        nombre: String(c.empresa ?? c.nombre_contacto ?? "—"),
        pm: typeof c.project_manager_id === "string" ? c.project_manager_id : null,
      },
    ])
  );

  const porProyecto = agruparHistorial(historial);
  const ultimaTarea = new Map<string, number>();
  for (const t of tareas) {
    const ms = Date.parse(t.updated_at);
    if (Number.isFinite(ms)) ultimaTarea.set(t.proyecto_id, Math.max(ultimaTarea.get(t.proyecto_id) ?? 0, ms));
  }
  const ultimoComentario = new Map<string, number>();
  for (const c of comentarios) {
    const ms = Date.parse(c.created_at);
    if (Number.isFinite(ms)) {
      ultimoComentario.set(c.proyecto_id, Math.max(ultimoComentario.get(c.proyecto_id) ?? 0, ms));
    }
  }

  // Tiempo laboral por estado (segmentos cerrados): alimenta "Tiempo promedio
  // en cada estado".
  const msPorEstado = new Map<string, { total: number; n: number }>();
  for (const h of historial) {
    if (!h.estado_nuevo_id || !h.entered_at || !h.exited_at) continue;
    const dur = msLaborables(h.entered_at, h.exited_at);
    if (dur == null) continue;
    const agg = msPorEstado.get(h.estado_nuevo_id) ?? { total: 0, n: 0 };
    agg.total += dur;
    agg.n += 1;
    msPorEstado.set(h.estado_nuevo_id, agg);
  }

  let atribucionParcial = false;
  const proyectos: ProyectoMetrica[] = proyectosRows.map((row) => {
    const id = String(row.id);
    const filas = porProyecto.get(id) ?? [];
    const estadoId = typeof row.estado_id === "string" ? row.estado_id : null;
    const estado = estadoId ? estadoById.get(estadoId) ?? null : null;
    const tipoId = typeof row.tipo_id === "string" ? row.tipo_id : null;
    const clienteId = typeof row.cliente_id === "string" ? row.cliente_id : null;
    const cli = clienteId ? clientes.get(clienteId) ?? null : null;

    const slv = slvTecnicoDeProyecto(id, filas, esTecnico, refMs);
    if (!slv.atribucion_confiable) atribucionParcial = true;
    const qa = qaDeProyecto(id, filas, esQa, esTecnico);

    // Segmento abierto del estado actual: de ahí sale el tiempo en estado.
    const abierto = filas.find((f) => f.estado_nuevo_id === estadoId && f.exited_at == null);
    const estadoDesde =
      abierto?.entered_at ??
      [...filas].reverse().find((f) => f.estado_nuevo_id === estadoId)?.entered_at ??
      (typeof row.created_at === "string" ? row.created_at : null);
    const tiempoEnEstado = estadoDesde ? msLaborables(estadoDesde, refIso) : null;

    const entregaRaw =
      (typeof row.primera_entrega_at === "string" ? row.primera_entrega_at : null) ??
      (typeof row.fecha_entrega === "string" ? row.fecha_entrega : null);
    const entregaMs = entregaRaw ? Date.parse(entregaRaw) : Number.NaN;
    const esFinal = estadoId ? idsFinal.has(estadoId) : false;
    const cancelado = esFinal && estadoId !== idEntregado;
    const entregado =
      !cancelado && ((Number.isFinite(entregaMs) && entregaMs <= refMs) || estadoId === idEntregado);

    const fp = typeof row.fecha_prometida === "string" ? Date.parse(row.fecha_prometida) : Number.NaN;
    const diasRestantes = Number.isFinite(fp) ? Math.ceil((fp - refMs) / 86400000) : null;
    const entregadoATiempo =
      entregado && Number.isFinite(fp) && Number.isFinite(entregaMs) ? entregaMs <= fp : null;

    const responsabilidadTecnica = estadoId ? idsTecnicos.has(estadoId) : false;
    const enQa = estadoId ? idsQa.has(estadoId) : false;
    const esperaCliente = estadoId ? idsCliente.has(estadoId) : false;
    const listoEntregar = estadoId ? idsListo.has(estadoId) : false;
    const pausado = estadoId ? idsPausado.has(estadoId) : false;

    // "Estancado": lleva más tiempo en el estado que el objetivo configurado
    // para ESE estado (`proyecto_estados.sla_horas_objetivo`). Sin objetivo no
    // se inventa uno: un estado sin meta no puede estar por encima de nada.
    const objetivoEstado = estado?.sla_horas_objetivo ?? null;
    const estancado =
      !entregado && !cancelado && objetivoEstado != null && tiempoEnEstado != null
        ? tiempoEnEstado > objetivoEstado * 3600_000
        : false;

    // Objetivo de SLV: el del proyecto manda; si no, el del tipo.
    const objId = typeof row.slv_objetivo_id === "string" ? row.slv_objetivo_id : null;
    const objetivoHoras =
      (objId ? objetivoPorId.get(objId) ?? null : null) ??
      (tipoId ? objetivoDeTipo.get(tipoId) ?? null : null);
    const pct = consumoPct(slv.total_ms, objetivoHoras);

    const marcas = [
      slv.ultima_actividad_at ? Date.parse(slv.ultima_actividad_at) : 0,
      ultimaTarea.get(id) ?? 0,
      ultimoComentario.get(id) ?? 0,
      ...filas.map((f) => (f.entered_at ? Date.parse(f.entered_at) : 0)),
    ].filter((n) => Number.isFinite(n) && n > 0);
    const actividadMs = marcas.length > 0 ? Math.max(...marcas) : 0;
    const ultimaActividad = actividadMs > 0 ? new Date(actividadMs).toISOString() : null;
    const sinMovimientoMs =
      ultimaActividad && responsabilidadTecnica ? msLaborables(ultimaActividad, refIso) : null;
    const sinMovimiento = sinMovimientoMs != null && sinMovimientoMs > MS_SIN_MOVIMIENTO;

    const bloqueadoFlag = row.bloqueado === true;
    const bloqueoTipo =
      typeof row.bloqueo_tipo === "string" && ["cliente", "interno", "tercero"].includes(row.bloqueo_tipo)
        ? (row.bloqueo_tipo as BloqueoTipo)
        : null;

    const nivel = nivelSlv(pct);
    const motivos: Motivo[] = [];
    if (!entregado && !cancelado) {
      if (diasRestantes != null && diasRestantes < 0) motivos.push(motivo("vencido", "Vencido"));
      else if (diasRestantes != null && diasRestantes <= DIAS_VENCE_PRONTO) {
        motivos.push(
          motivo(
            "vence_pronto",
            diasRestantes === 0 ? "Vence hoy" : `Vence en ${diasRestantes} día${diasRestantes === 1 ? "" : "s"}`
          )
        );
      }
      if (bloqueadoFlag || pausado) motivos.push(motivo("bloqueado", "Bloqueado"));
      if (nivel === "vencido") motivos.push(motivo("slv_vencido", `SLV ${pct}%`));
      else if (nivel === "critico") motivos.push(motivo("slv_critico", `SLV ${pct}%`));
      else if (nivel === "en_riesgo") motivos.push(motivo("slv_riesgo", `SLV ${pct}%`));
      if (sinMovimiento) motivos.push(motivo("sin_movimiento", "Sin movimiento técnico"));
      if (estancado && tiempoEnEstado != null) {
        const jornadas = Math.round((tiempoEnEstado / MS_JORNADA) * 10) / 10;
        motivos.push(motivo("estancado", `${jornadas} jornadas en ${estado?.nombre ?? "el estado"}`));
      }
      if (qa.rondas >= 2) motivos.push(motivo("reingreso_qa", `${qa.rondas} rondas de QA`));
      if (esperaCliente) motivos.push(motivo("espera_cliente", "Esperando al cliente"));
      if (listoEntregar) motivos.push(motivo("listo_entregar", "Listo para entregar"));
    }

    return {
      id,
      titulo: String(row.titulo ?? "—"),
      cliente_id: clienteId,
      cliente: cli?.nombre ?? "—",
      estado_id: estadoId,
      estado_nombre: estado?.nombre ?? "—",
      estado_codigo: estado?.codigo ?? null,
      estado_color: estado?.color ?? "#94a3b8",
      tipo_id: tipoId,
      tipo_nombre: tipoId ? tipoNombre.get(tipoId) ?? "—" : "—",
      responsable_tecnico_id:
        typeof row.responsable_tecnico_id === "string" ? row.responsable_tecnico_id : null,
      tecnico: nombreDe(nombres, row.responsable_tecnico_id as string | null),
      responsable_comercial_id:
        typeof row.responsable_comercial_id === "string" ? row.responsable_comercial_id : null,
      // El PM del proyecto manda; si no tiene, hereda el de la ficha del
      // cliente. Así los proyectos sin cliente pueden tener responsable y un
      // cliente puede repartir sus proyectos entre dos PM.
      project_manager_id:
        (typeof row.project_manager_id === "string" ? row.project_manager_id : null) ?? cli?.pm ?? null,
      fecha_ingreso: typeof row.fecha_ingreso === "string" ? row.fecha_ingreso : null,
      fecha_prometida: typeof row.fecha_prometida === "string" ? row.fecha_prometida : null,
      fecha_entrega: entregaRaw,
      dias_restantes: diasRestantes,
      entregado,
      cancelado,
      entregado_a_tiempo: entregadoATiempo,
      tiempo_en_estado_ms: tiempoEnEstado,
      estado_desde: estadoDesde,
      bloqueado: bloqueadoFlag || pausado,
      bloqueo_tipo: bloqueoTipo,
      bloqueo_motivo: typeof row.bloqueo_motivo === "string" ? row.bloqueo_motivo : null,
      espera_cliente: esperaCliente,
      en_qa: enQa,
      listo_entregar: listoEntregar,
      responsabilidad_tecnica: responsabilidadTecnica,
      estancado,
      slv_consumido_ms: slv.total_ms,
      slv_objetivo_horas: objetivoHoras,
      slv_consumo_pct: pct,
      slv_nivel: nivel,
      slv_atribucion_confiable: slv.atribucion_confiable,
      slv_por_tecnico: slv.por_tecnico,
      qa,
      ultima_actividad_at: ultimaActividad,
      sin_movimiento_ms: sinMovimientoMs,
      sin_movimiento: sinMovimiento,
      motivos,
      score: scorePrioridad(motivos, diasRestantes),
      lead_time_ms:
        entregado && typeof row.fecha_ingreso === "string" && entregaRaw
          ? msLaborables(row.fecha_ingreso, entregaRaw)
          : null,
    };
  });

  const filtrados = filtros.pmId
    ? proyectos.filter((p) => p.project_manager_id === filtros.pmId)
    : proyectos;

  const tecnicosOpciones = [
    ...new Set(
      ((asignaciones.data ?? []) as { responsable_tecnico_id: string | null }[])
        .map((a) => a.responsable_tecnico_id)
        .filter((x): x is string => typeof x === "string")
    ),
  ]
    .map((id) => ({ id, nombre: nombres.get(id) ?? "—" }))
    .filter((o) => o.nombre !== "—")
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  return {
    refMs,
    estados,
    tipos,
    proyectos: filtrados,
    tecnicosOpciones,
    wipLimite: WIP_LIMITE_DEFAULT,
    nombreUsuario: (id: string) => nombres.get(id) ?? "—",
    msPorEstado,
    atribucionParcial,
  };
}

/**
 * ¿El proyecto ocupa lugar en el WIP del técnico?
 *
 * Ni entregado ni cancelado, y todavía dentro del circuito técnico. Un proyecto
 * esperando al cliente o listo para entregar no le ocupa un lugar al técnico:
 * ahí ya no tiene nada que hacer.
 */
export function cuentaParaWip(p: ProyectoMetrica): boolean {
  if (p.entregado || p.cancelado) return false;
  return p.responsabilidad_tecnica || p.en_qa;
}

/** KPIs que comparten las dos pantallas. Se calculan una sola vez. */
export function kpisComunes(proyectos: ProyectoMetrica[], wipAlto: number) {
  const activos = proyectos.filter((p) => !p.entregado && !p.cancelado);
  return {
    vencen_pronto: activos.filter(
      (p) => p.dias_restantes != null && p.dias_restantes >= 0 && p.dias_restantes <= DIAS_VENCE_PRONTO
    ).length,
    vencidos: activos.filter((p) => p.dias_restantes != null && p.dias_restantes < 0).length,
    bloqueados: activos.filter((p) => p.bloqueado).length,
    estancados: activos.filter((p) => p.estancado).length,
    esperando_cliente: activos.filter((p) => p.espera_cliente).length,
    esperando_qa: activos.filter((p) => p.en_qa).length,
    listos_entregar: activos.filter((p) => p.listo_entregar).length,
    tecnicos_wip_alto: wipAlto,
  };
}
