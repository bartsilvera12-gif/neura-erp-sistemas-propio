import "server-only";

/**
 * Dashboard PM — la pantalla de acción.
 *
 * Responde "¿dónde tengo que intervenir hoy?", así que acá sí van las listas
 * operativas: qué hay que hacer, sobre qué proyecto y de quién es la próxima
 * jugada.
 */

import { BLOQUEO_TIPO_LABEL, categoriaBloqueo } from "./config";
import { nivelWip } from "./semaforo";
import { calcularWip } from "./workload";
import { cuentaParaWip, kpisComunes, type Dataset, type ProyectoMetrica } from "./shared";
import { motivoDePlazo, type Motivo } from "./priority-score";

/**
 * Próxima acción y de quién es.
 *
 * No hay un campo "próxima acción" en el modelo, y no se inventa uno: se deriva
 * del motivo por el que el proyecto pide atención. Es la misma lectura que hace
 * un PM mirando la tarjeta, escrita una sola vez.
 */
function proximaAccion(p: ProyectoMetrica): { accion: string; dueno: string } {
  const cod = p.motivos[0]?.codigo;
  if (p.bloqueado) return { accion: "Destrabar", dueno: p.bloqueo_tipo === "cliente" ? "Cliente" : "PM" };
  if (p.espera_cliente) return { accion: "Contactar cliente", dueno: "PM" };
  if (p.en_qa) return { accion: "Revisar proyecto", dueno: "QA" };
  if (p.listo_entregar) return { accion: "Coordinar capacitación", dueno: "PM" };
  if (p.responsabilidad_tecnica) {
    return { accion: cod === "sin_movimiento" ? "Retomar trabajo" : "Terminar pruebas", dueno: p.tecnico };
  }
  return { accion: "Revisar estado", dueno: "PM" };
}

/**
 * `motivoMostrado`: el motivo que va en la columna.
 *
 * Se pasa desde afuera porque la tabla filtra por plazo y tiene que explicar
 * ESE plazo. Si mostrara el primer motivo de la lista, una fila podría entrar
 * por estar vencida y decir "Bloqueado", que no explica por qué está ahí.
 */
function filaProyecto(p: ProyectoMetrica, motivoMostrado?: Motivo | null) {
  const { accion, dueno } = proximaAccion(p);
  const m = motivoMostrado ?? p.motivos[0] ?? null;
  return {
    id: p.id,
    titulo: p.titulo,
    cliente: p.cliente,
    estado_nombre: p.estado_nombre,
    estado_color: p.estado_color,
    motivo: m?.label ?? "—",
    motivo_codigo: m?.codigo ?? null,
    tiempo_en_estado_ms: p.tiempo_en_estado_ms,
    fecha_prometida: p.fecha_prometida,
    proxima_accion: accion,
    dueno,
  };
}

export function construirDashboardPm(ds: Dataset) {
  const { proyectos, wipLimite } = ds;
  const activos = proyectos.filter((p) => !p.entregado && !p.cancelado);

  const wip = calcularWip(
    proyectos.filter(cuentaParaWip).map((p) => ({
      responsable_tecnico_id: p.responsable_tecnico_id,
      estado_id: p.estado_id,
    })),
    () => true,
    ds.nombreUsuario,
    wipLimite
  );
  const wipPorTecnico = new Map(wip.map((w) => [w.usuario_id, w.wip]));
  const wipAlto = wip.filter((w) => nivelWip(w.wip, wipLimite) === "sobre_limite").length;

  // ---- Atención PM de hoy ---------------------------------------------------
  // Sólo lo que corre contra un plazo: vencido o por vencer, sea por la fecha
  // prometida al cliente o por el objetivo interno de tiempo. Un proyecto
  // bloqueado o con muchas rondas de QA necesita atención, pero no es lo que
  // se mira para saber qué se está por incumplir hoy — y mezclarlo hacía que
  // lo urgente compitiera con lo importante en la misma lista.
  const atencion = activos
    .map((p) => ({ p, plazo: motivoDePlazo(p.motivos) }))
    .filter((x): x is { p: ProyectoMetrica; plazo: Motivo } => x.plazo !== null)
    .sort((a, b) => b.p.score - a.p.score)
    .slice(0, 30)
    .map(({ p, plazo }) => filaProyecto(p, plazo));

  // ---- SLV por desarrollador ------------------------------------------------
  // Dos poblaciones distintas y separadas a propósito:
  //   · "en riesgo / vencidos" mira lo que está EN CURSO ahora.
  //   · "cumplimiento %" mira lo TERMINADO con objetivo, que es lo único con lo
  //     que se puede juzgar si un objetivo se cumplió o no.
  const porTecnico = new Map<
    string,
    { dentro: number; riesgo: number; vencidos: number; cerrados: number; cerradosOk: number }
  >();
  const agg = (id: string) => {
    const a = porTecnico.get(id) ?? { dentro: 0, riesgo: 0, vencidos: 0, cerrados: 0, cerradosOk: 0 };
    porTecnico.set(id, a);
    return a;
  };
  for (const p of proyectos) {
    const tid = p.responsable_tecnico_id;
    if (!tid || p.slv_nivel == null) continue;
    if (p.entregado) {
      const a = agg(tid);
      a.cerrados += 1;
      if (p.slv_nivel !== "vencido") a.cerradosOk += 1;
      continue;
    }
    if (p.cancelado) continue;
    const a = agg(tid);
    if (p.slv_nivel === "vencido") a.vencidos += 1;
    else if (p.slv_nivel === "en_riesgo" || p.slv_nivel === "critico") a.riesgo += 1;
    else a.dentro += 1;
  }
  const slv_por_desarrollador = [...porTecnico.entries()]
    .map(([usuario_id, v]) => ({
      usuario_id,
      nombre: ds.nombreUsuario(usuario_id),
      wip: wipPorTecnico.get(usuario_id) ?? 0,
      dentro: v.dentro,
      en_riesgo: v.riesgo,
      vencidos: v.vencidos,
      cerrados: v.cerrados,
      cumplimiento_pct: v.cerrados > 0 ? Math.round((v.cerradosOk / v.cerrados) * 100) : null,
    }))
    .sort((a, b) => b.wip - a.wip || a.nombre.localeCompare(b.nombre, "es"));

  // ---- Proyectos en riesgo de SLV -------------------------------------------
  const riesgo_slv = activos
    .filter((p) => p.slv_nivel === "en_riesgo" || p.slv_nivel === "critico" || p.slv_nivel === "vencido" || p.sin_movimiento)
    .sort((a, b) => (b.slv_consumo_pct ?? 0) - (a.slv_consumo_pct ?? 0))
    .slice(0, 25)
    .map((p) => ({
      id: p.id,
      titulo: p.titulo,
      tecnico: p.tecnico,
      estado_nombre: p.estado_nombre,
      estado_color: p.estado_color,
      consumido_ms: p.slv_consumido_ms,
      objetivo_horas: p.slv_objetivo_horas,
      consumo_pct: p.slv_consumo_pct,
      nivel: p.slv_nivel,
      sin_movimiento_ms: p.sin_movimiento_ms,
      sin_movimiento: p.sin_movimiento,
      atribucion_confiable: p.slv_atribucion_confiable,
    }));

  // ---- QA y retrabajos ------------------------------------------------------
  const qa_retrabajos = proyectos
    .filter((p) => p.qa.rondas >= 2)
    .sort((a, b) => b.qa.rondas - a.qa.rondas)
    .slice(0, 25)
    .map((p) => ({
      id: p.id,
      titulo: p.titulo,
      tecnico: p.tecnico,
      rondas: p.qa.rondas,
      ultima_entrada_at: p.qa.ultima_entrada_at,
      estado_nombre: p.estado_nombre,
      destacado: p.qa.rondas >= 3,
    }));

  // ---- Esperando cliente ----------------------------------------------------
  // El tiempo se muestra, pero NO consume SLV técnico: estos estados no son de
  // responsabilidad técnica, así que el reloj del desarrollador está detenido.
  const esperando_cliente = activos
    .filter((p) => p.espera_cliente)
    .sort((a, b) => (b.tiempo_en_estado_ms ?? 0) - (a.tiempo_en_estado_ms ?? 0))
    .slice(0, 25)
    .map((p) => ({
      id: p.id,
      titulo: p.titulo,
      cliente: p.cliente,
      falta: p.estado_nombre,
      desde: p.estado_desde,
      tiempo_ms: p.tiempo_en_estado_ms,
      ultimo_contacto: p.ultima_actividad_at,
    }));

  // ---- Bloqueos activos -----------------------------------------------------
  const bloqueos = activos
    .filter((p) => p.bloqueado)
    .sort((a, b) => (b.tiempo_en_estado_ms ?? 0) - (a.tiempo_en_estado_ms ?? 0))
    .slice(0, 25)
    .map((p) => {
      const tipo = categoriaBloqueo(p);
      const { accion, dueno } = proximaAccion(p);
      return {
        id: p.id,
        titulo: p.titulo,
        tipo,
        tipo_label: BLOQUEO_TIPO_LABEL[tipo],
        motivo: p.bloqueo_motivo ?? p.estado_nombre,
        desde: p.estado_desde,
        tiempo_ms: p.tiempo_en_estado_ms,
        proxima_accion: accion,
        responsable: dueno,
      };
    });

  return {
    vista: "pm" as const,
    kpis: kpisComunes(proyectos, wipAlto),
    wip_limite: wipLimite,
    atencion,
    slv_por_desarrollador,
    riesgo_slv,
    wip,
    qa_retrabajos,
    esperando_cliente,
    bloqueos,
    opciones: {
      tipos: ds.tipos.map((t) => ({ id: t.id, nombre: t.nombre })),
      estados: ds.estados.map((e) => ({ id: e.id, nombre: e.nombre ?? "—", color: e.color })),
      tecnicos: ds.tecnicosOpciones,
      pms: ds.pmsOpciones,
    },
    atribucion_parcial: ds.atribucionParcial,
  };
}

export type DashboardPm = ReturnType<typeof construirDashboardPm>;
