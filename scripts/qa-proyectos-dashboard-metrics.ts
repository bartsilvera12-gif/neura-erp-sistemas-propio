/**
 * Pruebas de los helpers críticos de los dashboards de Proyectos.
 *
 * Corren sin base: los helpers son puros y reciben filas de historial, que es
 * exactamente lo que hace que se puedan probar. Son los diez casos que definió
 * Dirección al pedir el dashboard.
 *
 *   npx tsx scripts/qa-proyectos-dashboard-metrics.ts
 */

import { slvTecnicoDeProyecto, type SegmentoHistorial } from "@/lib/proyectos/dashboard/technical-slv";
import { qaDeProyecto, resumirQa } from "@/lib/proyectos/dashboard/qa-metrics";
import { calcularWip } from "@/lib/proyectos/dashboard/workload";
import { consumoPct, nivelSlv, nivelWip } from "@/lib/proyectos/dashboard/semaforo";
import { msLaborables } from "@/lib/proyectos/reloj-laboral";
import { enPeriodo } from "@/lib/proyectos/dashboard/periodo";

// --- Andamiaje mínimo --------------------------------------------------------

let fallos = 0;
let corridas = 0;

function check(nombre: string, real: unknown, esperado: unknown) {
  corridas += 1;
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) {
    fallos += 1;
    console.error(`  ✗ ${nombre}\n      esperado: ${JSON.stringify(esperado)}\n      obtenido: ${JSON.stringify(real)}`);
  } else {
    console.log(`  ✓ ${nombre}`);
  }
}

const HORA = 3600_000;

/**
 * Los tramos se expresan en horas laborales dentro de UN MISMO día hábil, para
 * que el reloj laboral no meta ruido: el lunes 1/9/2026 de 08:00 a 17:00 (hora
 * de Paraguay, UTC-3) son nueve horas de trabajo corridas.
 */
const LUNES = "2026-09-07"; // lunes
const MARTES = "2026-09-08";
const MIERCOLES = "2026-09-09";

/** Instante ISO a partir de un día y una hora local de Paraguay (UTC-3). */
function t(dia: string, hora: number, minutos = 0): string {
  const hh = String(hora).padStart(2, "0");
  const mm = String(minutos).padStart(2, "0");
  return `${dia}T${hh}:${mm}:00-03:00`;
}

const EST = { desarrollo: "e-dev", qa: "e-qa", cambios: "e-cam", cliente: "e-cli", entregado: "e-ent" };
const esTecnico = (id: string) => id === EST.desarrollo || id === EST.cambios;
const esQa = (id: string) => id === EST.qa;

function seg(p: Partial<SegmentoHistorial> & { entered_at: string }): SegmentoHistorial {
  return {
    proyecto_id: "p1",
    estado_nuevo_id: null,
    exited_at: null,
    responsable_tecnico_id: null,
    metadata: null,
    ...p,
  };
}

function reasignacion(at: string, de: string | null, a: string | null): SegmentoHistorial {
  return seg({ entered_at: at, exited_at: at, metadata: { tipo: "reasignacion_tecnico", de, a } });
}

const KAREN = "u-karen";
const IVAN = "u-ivan";

// --- CASO 1 — el reloj técnico sólo corre en estados técnicos ---------------
console.log("\nCASO 1 · SLV sólo en desarrollo y cambios");
{
  const filas: SegmentoHistorial[] = [
    // 8 h de desarrollo: lunes 08:00 → 17:00 menos la hora que sobra.
    seg({ estado_nuevo_id: EST.desarrollo, entered_at: t(LUNES, 8), exited_at: t(LUNES, 16), responsable_tecnico_id: KAREN }),
    // Una jornada entera en QA: no suma.
    seg({ estado_nuevo_id: EST.qa, entered_at: t(LUNES, 16), exited_at: t(MARTES, 16), responsable_tecnico_id: KAREN }),
    // 4 h de cambios solicitados: vuelve a correr.
    seg({ estado_nuevo_id: EST.cambios, entered_at: t(MIERCOLES, 8), exited_at: t(MIERCOLES, 12), responsable_tecnico_id: KAREN }),
    seg({ estado_nuevo_id: EST.qa, entered_at: t(MIERCOLES, 12), exited_at: t(MIERCOLES, 14), responsable_tecnico_id: KAREN }),
    // Revisión con el cliente: tampoco suma.
    seg({ estado_nuevo_id: EST.cliente, entered_at: t(MIERCOLES, 14), exited_at: t(MIERCOLES, 16), responsable_tecnico_id: KAREN }),
    seg({ estado_nuevo_id: EST.entregado, entered_at: t(MIERCOLES, 16), exited_at: t(MIERCOLES, 16), responsable_tecnico_id: KAREN }),
  ];
  const r = slvTecnicoDeProyecto("p1", filas, esTecnico, Date.parse(t(MIERCOLES, 17)));
  check("SLV total = 12 h", r.total_ms / HORA, 12);
  check("SLV de Karen = 12 h", (r.por_tecnico.get(KAREN) ?? 0) / HORA, 12);
  const qa = qaDeProyecto("p1", filas, esQa, esTecnico);
  check("rondas de QA = 2", qa.rondas, 2);
  check("hubo reingreso", qa.reingreso, true);
  check("no es first pass", qa.first_pass, false);
}

// --- CASO 2 — reasignación: cada uno con lo suyo ----------------------------
console.log("\nCASO 2 · reasignación de desarrollador");
{
  const filas: SegmentoHistorial[] = [
    // Un ÚNICO segmento de desarrollo de 12 h laborales, partido por la
    // reasignación de las 16:00 del lunes: 8 h de Karen (lunes 08–16) y 4 h de
    // Iván (la última hora del lunes más tres del martes).
    seg({
      estado_nuevo_id: EST.desarrollo,
      entered_at: t(LUNES, 8),
      exited_at: t(MARTES, 11),
      responsable_tecnico_id: KAREN,
    }),
    reasignacion(t(LUNES, 16), KAREN, IVAN),
  ];
  const r = slvTecnicoDeProyecto("p1", filas, esTecnico, Date.parse(t(MARTES, 17)));
  check("tiempo técnico del proyecto = 12 h", r.total_ms / HORA, 12);
  check("Karen = 8 h", (r.por_tecnico.get(KAREN) ?? 0) / HORA, 8);
  check("Iván = 4 h", (r.por_tecnico.get(IVAN) ?? 0) / HORA, 4);
  check("no se le atribuyen las 12 h al técnico actual", r.por_tecnico.get(IVAN) !== r.total_ms, true);
}

// --- CASO 3 — revisión del cliente no consume SLV ---------------------------
console.log("\nCASO 3 · 3 días en revisión del cliente");
{
  const filas: SegmentoHistorial[] = [
    seg({ estado_nuevo_id: EST.cliente, entered_at: t(LUNES, 8), exited_at: t(MIERCOLES, 17), responsable_tecnico_id: KAREN }),
  ];
  const r = slvTecnicoDeProyecto("p1", filas, esTecnico, Date.parse(t(MIERCOLES, 17)));
  check("SLV del desarrollador = 0", r.total_ms, 0);
}

// --- CASO 4 — pausa por un tercero no consume SLV ---------------------------
console.log("\nCASO 4 · pausado por un tercero");
{
  const PAUSA = "e-pausa";
  const filas: SegmentoHistorial[] = [
    seg({ estado_nuevo_id: EST.desarrollo, entered_at: t(LUNES, 8), exited_at: t(LUNES, 10), responsable_tecnico_id: KAREN }),
    seg({ estado_nuevo_id: PAUSA, entered_at: t(LUNES, 10), exited_at: t(MIERCOLES, 17), responsable_tecnico_id: KAREN }),
  ];
  const r = slvTecnicoDeProyecto("p1", filas, esTecnico, Date.parse(t(MIERCOLES, 17)));
  check("sólo suman las 2 h de desarrollo", r.total_ms / HORA, 2);
}

// --- CASOS 5 y 6 — semáforo -------------------------------------------------
console.log("\nCASOS 5 y 6 · semáforo de consumo");
{
  check("12 h sobre 16 h = 75 %", consumoPct(12 * HORA, 16), 75);
  check("75 % es 'en riesgo'", nivelSlv(75), "en_riesgo");
  check("17 h sobre 16 h = 106,3 %", consumoPct(17 * HORA, 16), 106.3);
  check("106,3 % es 'vencido'", nivelSlv(106.3), "vencido");
  check("el borde de 70 % sigue al día", nivelSlv(70), "al_dia");
  check("el borde de 90 % sigue en riesgo", nivelSlv(90), "en_riesgo");
  check("91 % es crítico", nivelSlv(91), "critico");
  check("100 % todavía no está vencido", nivelSlv(100), "critico");
  check("sin objetivo no hay consumo", consumoPct(10 * HORA, null), null);
  check("sin consumo no hay nivel", nivelSlv(null), null);
}

// --- CASO 7 — tres rondas de QA ---------------------------------------------
console.log("\nCASO 7 · tres entradas a QA");
{
  const filas: SegmentoHistorial[] = [
    seg({ estado_nuevo_id: EST.desarrollo, entered_at: t(LUNES, 8), exited_at: t(LUNES, 9) }),
    seg({ estado_nuevo_id: EST.qa, entered_at: t(LUNES, 9), exited_at: t(LUNES, 10) }),
    seg({ estado_nuevo_id: EST.cambios, entered_at: t(LUNES, 10), exited_at: t(LUNES, 11) }),
    seg({ estado_nuevo_id: EST.qa, entered_at: t(LUNES, 11), exited_at: t(LUNES, 12) }),
    seg({ estado_nuevo_id: EST.cambios, entered_at: t(LUNES, 12), exited_at: t(LUNES, 13) }),
    seg({ estado_nuevo_id: EST.qa, entered_at: t(LUNES, 13), exited_at: t(LUNES, 14) }),
  ];
  const qa = qaDeProyecto("p1", filas, esQa, esTecnico);
  check("rondas de QA = 3", qa.rondas, 3);
  check("entra en retrabajos (3 o más)", qa.rondas >= 3, true);
  const resumen = resumirQa([qa]);
  check("promedio de rondas = 3", resumen.promedio_rondas, 3);
  check("con 3 o más rondas = 1", resumen.con_tres_o_mas, 1);
  check("first pass = 0 %", resumen.first_pass_pct, 0);
}

// --- first pass, como contraste ---------------------------------------------
console.log("\nExtra · aprobado en la primera revisión");
{
  const filas: SegmentoHistorial[] = [
    seg({ estado_nuevo_id: EST.desarrollo, entered_at: t(LUNES, 8), exited_at: t(LUNES, 9) }),
    seg({ estado_nuevo_id: EST.qa, entered_at: t(LUNES, 9), exited_at: t(LUNES, 10) }),
    seg({ estado_nuevo_id: EST.entregado, entered_at: t(LUNES, 10), exited_at: null }),
  ];
  const qa = qaDeProyecto("p1", filas, esQa, esTecnico);
  check("una sola ronda", qa.rondas, 1);
  check("es first pass", qa.first_pass, true);
  check("sin reingreso", qa.reingreso, false);
}

// --- CASO 8 — WIP por encima del límite -------------------------------------
console.log("\nCASO 8 · WIP de 6 con límite 4");
{
  const proyectos = Array.from({ length: 6 }, () => ({
    responsable_tecnico_id: KAREN,
    estado_id: EST.desarrollo,
  }));
  proyectos.push({ responsable_tecnico_id: IVAN, estado_id: EST.desarrollo });
  const wip = calcularWip(proyectos, () => true, (id) => (id === KAREN ? "Karen" : "Iván"), 4);
  check("Karen tiene WIP 6", wip[0].wip, 6);
  check("Karen está sobre el límite", wip[0].nivel, "sobre_limite");
  check("técnicos con WIP alto = 1", wip.filter((w) => w.nivel === "sobre_limite").length, 1);
  check("WIP 4 está al límite", nivelWip(4, 4), "al_limite");
  check("WIP 3 está en rango", nivelWip(3, 4), "en_rango");
}

// --- CASOS 9 y 10 — cumplimiento de la fecha prometida ----------------------
console.log("\nCASOS 9 y 10 · cumplimiento de fecha prometida");
{
  // Se replica la fórmula del dashboard: entregados CON fecha prometida.
  type P = { entregado: boolean; cancelado: boolean; entregado_a_tiempo: boolean | null };
  const cartera: P[] = [
    { entregado: true, cancelado: false, entregado_a_tiempo: true },
    { entregado: true, cancelado: false, entregado_a_tiempo: false }, // caso 9
    { entregado: false, cancelado: true, entregado_a_tiempo: null }, // caso 10
    { entregado: true, cancelado: false, entregado_a_tiempo: null }, // sin fecha prometida
    { entregado: false, cancelado: false, entregado_a_tiempo: null }, // en curso
  ];
  const base = cartera.filter((p) => p.entregado && !p.cancelado && p.entregado_a_tiempo != null);
  const enFecha = base.filter((p) => p.entregado_a_tiempo === true).length;
  check("denominador = 2 (sin cancelados ni sin fecha)", base.length, 2);
  check("entregado tarde cuenta como incumplimiento", base.length - enFecha, 1);
  check("cumplimiento = 50 %", Math.round((enFecha / base.length) * 100), 50);
}

// --- Período: en curso + cerrados dentro del rango --------------------------
console.log('\nPeríodo · qué entra con "desde el 1 del mes"');
{
  const D = "2026-09-01";
  const H = "2026-09-30";
  const enCurso = { entregado: false, cancelado: false, fecha_entrega: null };
  const entregadoEsteMes = { entregado: true, cancelado: false, fecha_entrega: "2026-09-04T10:00:00Z" };
  const entregadoMesPasado = { entregado: true, cancelado: false, fecha_entrega: "2026-08-20T10:00:00Z" };
  const canceladoEsteMes = { entregado: false, cancelado: true, fecha_entrega: "2026-09-02T10:00:00Z" };
  const cerradoSinFecha = { entregado: true, cancelado: false, fecha_entrega: null };

  check("el trabajo en curso entra siempre", enPeriodo(enCurso, D, H), true);
  check("entra lo entregado dentro del período", enPeriodo(entregadoEsteMes, D, H), true);
  check("queda fuera lo entregado antes", enPeriodo(entregadoMesPasado, D, H), false);
  check("un cancelado también se ubica por su cierre", enPeriodo(canceladoEsteMes, D, H), true);
  check("cerrado sin fecha queda fuera, no se le inventa una", enPeriodo(cerradoSinFecha, D, H), false);
  check("sin período entra todo", enPeriodo(entregadoMesPasado, null, null), true);
  check("el borde del primer día entra", enPeriodo({ ...entregadoEsteMes, fecha_entrega: "2026-09-01T00:30:00-03:00" }, D, H), true);
}

// --- Reloj laboral: lun-vie 8 a 17, sáb 8 a 12 ------------------------------
console.log('\nReloj laboral · el SLA no corre fuera del horario');
{
  const h = (ms: number | null) => (ms == null ? null : Math.round((ms / HORA) * 10) / 10);
  // 2026-09-11 es viernes; 12 sábado; 13 domingo; 14 lunes.
  check("una jornada completa son 9 h", h(msLaborables(t("2026-09-11", 8), t("2026-09-11", 17))), 9);
  // Del viernes a las 17 al lunes a las 8 el único trabajo posible es el
  // sábado de 8 a 12: cuatro horas, no las 63 corridas del calendario.
  check("del viernes 17 al lunes 8 sólo cuenta el sábado", h(msLaborables(t("2026-09-11", 17), t("2026-09-14", 8))), 4);
  check("el sábado suma sólo la mañana", h(msLaborables(t("2026-09-12", 0), t("2026-09-12", 23, 59))), 4);
  check("el domingo no suma", h(msLaborables(t("2026-09-13", 0), t("2026-09-13", 23, 59))), 0);
  check("fuera de hora no suma", h(msLaborables(t("2026-09-11", 18), t("2026-09-11", 23))), 0);
  // 1 h del viernes + 4 del sábado + 1 del lunes.
  check(
    "del viernes 16 al lunes 9 son 6 h de trabajo",
    h(msLaborables(t("2026-09-11", 16), t("2026-09-14", 9))),
    6
  );
}

// --- Cierre ------------------------------------------------------------------
console.log(`\n${corridas - fallos}/${corridas} comprobaciones OK`);
if (fallos > 0) {
  console.error(`${fallos} fallaron`);
  process.exit(1);
}
