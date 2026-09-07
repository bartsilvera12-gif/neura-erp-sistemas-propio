import "server-only";

/**
 * Dashboard Ejecutivo — la lectura de Directorio.
 *
 * Responde "¿cómo está funcionando la cartera?", así que es RESUMEN: nada de
 * listas operativas largas ni de cycle time técnico (eso vive en el Dashboard
 * PM, que es la pantalla de acción).
 */

import { MS_JORNADA } from "@/lib/proyectos/reloj-laboral";
import { BLOQUEO_TIPO_LABEL, type BloqueoTipo } from "./config";
import { resumirQa } from "./qa-metrics";
import { nivelWip } from "./semaforo";
import { calcularWip } from "./workload";
import { cuentaParaWip, kpisComunes, type Dataset, type ProyectoMetrica } from "./shared";

/** Estados que Dirección mira en "Tiempo promedio en cada estado". */
const ESTADOS_DESTACADOS = ["cola_produccion", "desarrollo", "qa", "enviado_cliente", "pausado"];

function jornadas(ms: number | null): number | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  return Math.round((ms / MS_JORNADA) * 10) / 10;
}

function filaCritica(p: ProyectoMetrica) {
  return {
    id: p.id,
    titulo: p.titulo,
    cliente: p.cliente,
    estado_nombre: p.estado_nombre,
    estado_color: p.estado_color,
    tecnico: p.tecnico,
    fecha_prometida: p.fecha_prometida,
    dias_restantes: p.dias_restantes,
    motivo: p.motivos[0]?.label ?? "—",
    motivo_codigo: p.motivos[0]?.codigo ?? null,
    semaforo:
      p.dias_restantes != null && p.dias_restantes < 0
        ? "vencido"
        : p.bloqueado || p.estancado
          ? "critico"
          : "en_riesgo",
  };
}

export function construirDashboardEjecutivo(ds: Dataset) {
  const { proyectos, estados, wipLimite } = ds;
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
  const wipAlto = wip.filter((w) => nivelWip(w.wip, wipLimite) === "sobre_limite").length;

  // ---- A. Proyectos por estado --------------------------------------------
  const conteo = new Map<string, number>();
  for (const p of proyectos) {
    if (p.estado_id) conteo.set(p.estado_id, (conteo.get(p.estado_id) ?? 0) + 1);
  }
  const por_estado = estados
    .map((e) => ({
      estado_id: e.id,
      nombre: e.nombre ?? "—",
      color: e.color ?? "#94a3b8",
      cantidad: conteo.get(e.id) ?? 0,
    }))
    .filter((e) => e.cantidad > 0);

  // ---- B. Cumplimiento de fecha prometida ----------------------------------
  // Denominador: entregados CON fecha prometida. Los cancelados y los que nunca
  // tuvieron fecha quedan afuera — no se puede incumplir una fecha que no existe.
  const entregadosConFecha = proyectos.filter(
    (p) => p.entregado && !p.cancelado && p.entregado_a_tiempo != null
  );
  const enFecha = entregadosConFecha.filter((p) => p.entregado_a_tiempo === true).length;
  const conAtraso = entregadosConFecha.length - enFecha;
  const cumplimiento = {
    pct: entregadosConFecha.length > 0 ? Math.round((enFecha / entregadosConFecha.length) * 100) : null,
    en_fecha: enFecha,
    con_atraso: conAtraso,
    en_curso: activos.length,
  };

  // ---- C. Lead time (ingreso -> primera entrega, en jornadas) ---------------
  const leads = proyectos.map((p) => p.lead_time_ms).filter((x): x is number => x != null);
  const lead_time_jornadas =
    leads.length > 0 ? Math.round((leads.reduce((a, b) => a + b, 0) / leads.length / MS_JORNADA) * 10) / 10 : null;

  // ---- E. Tiempo promedio en cada estado -----------------------------------
  const tiempo_por_estado = estados
    .filter((e) => ESTADOS_DESTACADOS.includes(e.codigo ?? ""))
    .map((e) => {
      const agg = ds.msPorEstado.get(e.id);
      return {
        estado_id: e.id,
        nombre: e.nombre ?? "—",
        color: e.color ?? "#94a3b8",
        jornadas: agg && agg.n > 0 ? jornadas(agg.total / agg.n) : null,
      };
    })
    .filter((e) => e.jornadas != null);

  // ---- F. Calidad del desarrollo -------------------------------------------
  const calidad = resumirQa(proyectos.map((p) => p.qa));

  // ---- G. Proyectos críticos ------------------------------------------------
  // El orden lo da el score central (vencidos > bloqueados > estancados…), no
  // un `sort` improvisado en la tabla.
  const criticos = activos
    .filter((p) => p.motivos.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 25)
    .map(filaCritica);

  // ---- H. Bloqueos por tipo -------------------------------------------------
  const bloqueados = activos.filter((p) => p.bloqueado);
  const porTipo = new Map<string, number>();
  for (const p of bloqueados) {
    // Sin clasificación explícita se usa la que dice el ESTADO: un proyecto
    // parado en una columna `tipo_sla = cliente` está bloqueado por el cliente.
    const tipo: BloqueoTipo = p.bloqueo_tipo ?? (p.espera_cliente ? "cliente" : "interno");
    porTipo.set(tipo, (porTipo.get(tipo) ?? 0) + 1);
  }
  const bloqueos_por_tipo = (["cliente", "tercero", "interno"] as BloqueoTipo[])
    .map((t) => ({ tipo: t, label: BLOQUEO_TIPO_LABEL[t], cantidad: porTipo.get(t) ?? 0 }))
    .filter((b) => b.cantidad > 0);

  return {
    vista: "ejecutivo" as const,
    kpis: kpisComunes(proyectos, wipAlto),
    total_tecnicos: wip.length,
    wip_limite: wipLimite,
    por_estado,
    total_proyectos: proyectos.length,
    cumplimiento,
    lead_time_jornadas,
    wip,
    tiempo_por_estado,
    calidad,
    criticos,
    bloqueos_por_tipo,
    bloqueados_total: bloqueados.length,
    opciones: {
      tipos: ds.tipos.map((t) => ({ id: t.id, nombre: t.nombre })),
      estados: estados.map((e) => ({ id: e.id, nombre: e.nombre ?? "—" })),
      tecnicos: ds.tecnicosOpciones,
    },
    atribucion_parcial: ds.atribucionParcial,
  };
}

export type DashboardEjecutivo = ReturnType<typeof construirDashboardEjecutivo>;
