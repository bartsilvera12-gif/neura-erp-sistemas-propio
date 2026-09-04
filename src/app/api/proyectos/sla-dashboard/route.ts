import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { msLaborables } from "@/lib/proyectos/reloj-laboral";

/**
 * Dashboard SLA del módulo Proyectos. TODO sale de las tablas de proyectos:
 *   proyectos, proyecto_estados, proyecto_estado_historial (+ nombres de usuarios
 *   y clientes para display). Una sola pasada: se traen los proyectos activos y
 *   se computa todo en memoria (nada de un count por estado).
 *
 * Clasificación del semáforo (por fecha prometida, como el tablero):
 *   - entregado a tiempo (o sin fecha) -> al día
 *   - entregado tarde                  -> vencido
 *   - en curso, fecha vencida          -> vencido
 *   - en curso, vence en <= N días     -> en riesgo
 *   - en curso, resto (o sin fecha)    -> al día
 */

const DIAS_RIESGO = 3; // ventana de "en riesgo" (días hasta la fecha prometida)

type Semaforo = "al_dia" | "en_riesgo" | "vencido";

type ProyectoRow = {
  id: string;
  titulo: string | null;
  cliente_id: string | null;
  estado_id: string | null;
  tipo_id: string | null;
  responsable_comercial_id: string | null;
  responsable_tecnico_id: string | null;
  fecha_ingreso: string | null;
  fecha_prometida: string | null;
  fecha_entrega: string | null;
  primera_entrega_at: string | null;
  created_at: string | null;
  pausa_acumulada_ms: number | null;
};

type EstadoRow = {
  id: string;
  nombre: string | null;
  color: string | null;
  tipo_sla: string | null;
  es_estado_final: boolean | null;
  sort_order: number | null;
};

export async function GET(request: Request) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  try {
    const sp = new URL(request.url).searchParams;
    const fechaRaw = sp.get("fecha"); // YYYY-MM-DD, "as of"
    const fEstado = sp.get("estado_id");
    const fTipo = sp.get("tipo_id");
    const fRc = sp.get("responsable_comercial_id");
    const fRt = sp.get("responsable_tecnico_id");

    // Instante de referencia: fin del día elegido, o ahora si es hoy / vacío.
    const hoyIso = new Date().toISOString().slice(0, 10);
    const fecha = fechaRaw && /^\d{4}-\d{2}-\d{2}$/.test(fechaRaw) ? fechaRaw : hoyIso;
    const refMs =
      fecha === hoyIso ? Date.now() : new Date(`${fecha}T23:59:59`).getTime();

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const emp = auth.empresaId;

    const [estadosRes, proyectosBase] = await Promise.all([
      sb
        .from("proyecto_estados")
        .select("id, nombre, color, tipo_sla, es_estado_final, sort_order")
        .eq("empresa_id", emp)
        .eq("activo", true)
        .order("sort_order", { ascending: true }),
      (() => {
        let q = sb
          .from("proyectos")
          .select(
            "id, titulo, cliente_id, estado_id, tipo_id, responsable_comercial_id, responsable_tecnico_id, fecha_ingreso, fecha_prometida, fecha_entrega, primera_entrega_at, created_at, pausa_acumulada_ms"
          )
          .eq("empresa_id", emp)
          .eq("archivado", false);
        if (fEstado) q = q.eq("estado_id", fEstado);
        if (fTipo) q = q.eq("tipo_id", fTipo);
        if (fRc) q = q.eq("responsable_comercial_id", fRc);
        if (fRt) q = q.eq("responsable_tecnico_id", fRt);
        return q.limit(5000);
      })(),
    ]);

    if (estadosRes.error) return NextResponse.json(errorResponse(estadosRes.error.message), { status: 400 });
    if (proyectosBase.error) return NextResponse.json(errorResponse(proyectosBase.error.message), { status: 400 });

    const estados = (estadosRes.data ?? []) as EstadoRow[];
    const estadoById = new Map(estados.map((e) => [e.id, e]));
    const proyectos = (proyectosBase.data ?? []) as ProyectoRow[];

    // ---- Nombres (clientes + usuarios técnicos) para display ----
    const clienteIds = [...new Set(proyectos.map((p) => p.cliente_id).filter((x): x is string => !!x))];
    const tecnicoIds = [...new Set(proyectos.map((p) => p.responsable_tecnico_id).filter((x): x is string => !!x))];

    const catalog = createServiceRoleClient();
    const [cliRes, tecRes] = await Promise.all([
      clienteIds.length > 0
        ? sb.from("clientes").select("id, empresa, nombre_contacto").eq("empresa_id", emp).in("id", clienteIds)
        : Promise.resolve({ data: [] as { id: string; empresa?: string | null; nombre_contacto?: string | null }[] }),
      tecnicoIds.length > 0
        ? catalog.from("usuarios").select("id, nombre").eq("empresa_id", emp).in("id", tecnicoIds)
        : Promise.resolve({ data: [] as { id: string; nombre?: string | null }[] }),
    ]);
    const clienteNombre = new Map<string, string>();
    for (const c of cliRes.data ?? []) {
      clienteNombre.set(c.id, (c.empresa ?? "").trim() || (c.nombre_contacto ?? "").trim() || "—");
    }
    const tecnicoNombre = new Map<string, string>();
    for (const u of tecRes.data ?? []) {
      tecnicoNombre.set(u.id, (u.nombre ?? "").trim() || "—");
    }

    // ---- Clasificación por proyecto ----
    function clasificar(
      p: ProyectoRow,
      atMs: number
    ): { semaforo: Semaforo; dias: number | null; entregado: boolean } {
      const est = p.estado_id ? estadoById.get(p.estado_id) : undefined;
      const fp = p.fecha_prometida ? Date.parse(p.fecha_prometida) : NaN;
      const entregaMs = p.primera_entrega_at
        ? Date.parse(p.primera_entrega_at)
        : p.fecha_entrega
          ? Date.parse(p.fecha_entrega)
          : NaN;
      // "Entregado" a la fecha de corte: si la entrega es posterior, a esa fecha
      // todavía estaba en curso (esto es lo que permite comparar contra ayer).
      const entregado =
        (Number.isFinite(entregaMs) && entregaMs <= atMs) ||
        (!Number.isFinite(entregaMs) && est?.es_estado_final === true);
      if (entregado) {
        if (Number.isFinite(fp) && Number.isFinite(entregaMs) && entregaMs > fp) {
          return { semaforo: "vencido", dias: null, entregado: true };
        }
        return { semaforo: "al_dia", dias: null, entregado: true };
      }
      if (!Number.isFinite(fp)) return { semaforo: "al_dia", dias: null, entregado: false };
      const dias = Math.ceil((fp - atMs) / 86400000);
      if (fp < atMs) return { semaforo: "vencido", dias, entregado: false };
      if (dias <= DIAS_RIESGO) return { semaforo: "en_riesgo", dias, entregado: false };
      return { semaforo: "al_dia", dias, entregado: false };
    }

    /** ¿El proyecto ya existía a esa fecha de corte? */
    function existiaEn(p: ProyectoRow, atMs: number): boolean {
      const creado = p.fecha_ingreso
        ? Date.parse(p.fecha_ingreso)
        : p.created_at
          ? Date.parse(p.created_at)
          : NaN;
      return !Number.isFinite(creado) || creado <= atMs;
    }

    /** Resumen de semáforo a una fecha de corte (sirve para hoy y para ayer). */
    function resumenEn(atMs: number) {
      let vencidos = 0;
      let enRiesgo = 0;
      let alDia = 0;
      let total = 0;
      for (const p of proyectos) {
        if (!existiaEn(p, atMs)) continue;
        total += 1;
        const c = clasificar(p, atMs);
        if (c.semaforo === "vencido") vencidos += 1;
        else if (c.semaforo === "en_riesgo") enRiesgo += 1;
        else alDia += 1;
      }
      return {
        monitoreados: total,
        vencidos,
        en_riesgo: enRiesgo,
        al_dia: alDia,
        cumplimiento_pct: total > 0 ? Math.round(((total - vencidos) / total) * 100) : 100,
      };
    }

    const clas = new Map<string, { semaforo: Semaforo; dias: number | null; entregado: boolean }>();
    for (const p of proyectos) clas.set(p.id, clasificar(p, refMs));

    const hoy = resumenEn(refMs);
    const ayer = resumenEn(refMs - 86400000);
    const { monitoreados, vencidos, en_riesgo: enRiesgo, al_dia: alDia, cumplimiento_pct: cumplimientoPct } = hoy;

    // ---- Pausados / esperando cliente ----
    const estadoEspera = new Set(
      estados.filter((e) => e.tipo_sla === "pausado" || e.tipo_sla === "cliente").map((e) => e.id)
    );
    const pausados = proyectos.filter((p) => p.estado_id && estadoEspera.has(p.estado_id)).length;

    // ---- Por estado ----
    const conteoEstado = new Map<string, number>();
    for (const p of proyectos) {
      if (p.estado_id) conteoEstado.set(p.estado_id, (conteoEstado.get(p.estado_id) ?? 0) + 1);
    }
    const por_estado = estados
      .map((e) => ({
        estado_id: e.id,
        nombre: e.nombre ?? "—",
        color: e.color ?? "#94a3b8",
        cantidad: conteoEstado.get(e.id) ?? 0,
      }))
      .filter((e) => e.cantidad > 0);

    // ---- Cumplimiento por responsable técnico (sólo en curso) ----
    const porTec = new Map<string, { total: number; cumple: number }>();
    for (const p of proyectos) {
      const c = clas.get(p.id)!;
      if (c.entregado) continue; // sólo trabajo en curso
      const tid = p.responsable_tecnico_id;
      if (!tid) continue;
      const agg = porTec.get(tid) ?? { total: 0, cumple: 0 };
      agg.total += 1;
      if (c.semaforo !== "vencido") agg.cumple += 1;
      porTec.set(tid, agg);
    }
    const por_tecnico = [...porTec.entries()]
      .map(([usuario_id, v]) => ({
        usuario_id,
        nombre: tecnicoNombre.get(usuario_id) ?? "—",
        total: v.total,
        cumplimiento_pct: v.total > 0 ? Math.round((v.cumple / v.total) * 100) : 0,
      }))
      .sort((a, b) => b.cumplimiento_pct - a.cumplimiento_pct || b.total - a.total)
      .slice(0, 8);

    // ---- Tiempos promedio (horas laborales), computables a una fecha de corte ----
    const promedio = (xs: number[]) =>
      xs.length > 0 ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;

    /** Resolución: ingreso → 1ª entrega, sólo de lo entregado hasta la fecha de corte. */
    function resolucionEn(atMs: number): number | null {
      const xs: number[] = [];
      for (const p of proyectos) {
        if (!p.primera_entrega_at || !p.fecha_ingreso) continue;
        if (Date.parse(p.primera_entrega_at) > atMs) continue;
        const bruto = msLaborables(p.fecha_ingreso, p.primera_entrega_at);
        if (bruto == null) continue;
        xs.push(Math.max(0, bruto - Number(p.pausa_acumulada_ms ?? 0)));
      }
      return promedio(xs);
    }

    // Respuesta = tiempo hasta el primer movimiento de estado (primera transición
    // con estado anterior). Se saca del historial de los proyectos en pantalla.
    const primeraTrans = new Map<string, string>();
    if (proyectos.length > 0) {
      const ids = proyectos.map((p) => p.id);
      const { data: hist } = await sb
        .from("proyecto_estado_historial")
        .select("proyecto_id, entered_at, estado_anterior_id")
        .eq("empresa_id", emp)
        .in("proyecto_id", ids)
        .not("estado_anterior_id", "is", null)
        .order("entered_at", { ascending: true });
      for (const h of (hist ?? []) as { proyecto_id: string; entered_at: string }[]) {
        if (!primeraTrans.has(h.proyecto_id)) primeraTrans.set(h.proyecto_id, h.entered_at);
      }
    }
    const ingresoPorId = new Map(proyectos.map((p) => [p.id, p.fecha_ingreso]));

    /** Respuesta: sólo de los que ya se movieron hasta la fecha de corte. */
    function respuestaEn(atMs: number): number | null {
      const xs: number[] = [];
      for (const [pid, entered] of primeraTrans) {
        if (Date.parse(entered) > atMs) continue;
        const ing = ingresoPorId.get(pid);
        if (!ing) continue;
        const ms = msLaborables(ing, entered);
        if (ms != null && ms >= 0) xs.push(ms);
      }
      return promedio(xs);
    }

    const tiempo_resolucion_ms = resolucionEn(refMs);
    const tiempo_respuesta_ms = respuestaEn(refMs);
    const resolucionAyerMs = resolucionEn(refMs - 86400000);
    const respuestaAyerMs = respuestaEn(refMs - 86400000);

    // ---- Tendencia de cumplimiento últimos 7 días (reconstruida por fecha) ----
    const tendencia: { fecha: string; cumplimiento_pct: number }[] = [];
    for (let off = 6; off >= 0; off--) {
      const dMs = refMs - off * 86400000;
      const dIso = new Date(dMs).toISOString().slice(0, 10);
      let total = 0;
      let cumple = 0;
      for (const p of proyectos) {
        const creado = p.fecha_ingreso
          ? Date.parse(p.fecha_ingreso)
          : p.created_at
            ? Date.parse(p.created_at)
            : NaN;
        if (!Number.isFinite(creado) || creado > dMs) continue; // aún no existía
        const entrega = p.primera_entrega_at
          ? Date.parse(p.primera_entrega_at)
          : p.fecha_entrega
            ? Date.parse(p.fecha_entrega)
            : NaN;
        if (Number.isFinite(entrega) && entrega <= dMs) continue; // ya entregado a esa fecha
        total += 1;
        const fp = p.fecha_prometida ? Date.parse(p.fecha_prometida) : NaN;
        // A esa fecha estaba a tiempo si no había fecha o todavía no vencía.
        if (!Number.isFinite(fp) || fp >= dMs) cumple += 1;
      }
      tendencia.push({ fecha: dIso, cumplimiento_pct: total > 0 ? Math.round((cumple / total) * 100) : 100 });
    }

    // ---- Proyectos críticos / próximos vencimientos (en curso, con fecha) ----
    const criticos = proyectos
      .map((p) => ({ p, c: clas.get(p.id)! }))
      .filter((x) => !x.c.entregado && x.p.fecha_prometida)
      .filter((x) => x.c.semaforo !== "al_dia" || (x.c.dias ?? 999) <= 10)
      .sort((a, b) => (a.c.dias ?? 9999) - (b.c.dias ?? 9999))
      .slice(0, 12)
      .map((x) => {
        const est = x.p.estado_id ? estadoById.get(x.p.estado_id) : undefined;
        return {
          id: x.p.id,
          titulo: (x.p.titulo ?? "").trim() || "—",
          cliente: x.p.cliente_id ? clienteNombre.get(x.p.cliente_id) ?? "—" : "—",
          estado_nombre: est?.nombre ?? "—",
          estado_color: est?.color ?? "#94a3b8",
          responsable_tecnico: x.p.responsable_tecnico_id
            ? tecnicoNombre.get(x.p.responsable_tecnico_id) ?? "—"
            : "—",
          fecha_prometida: x.p.fecha_prometida,
          dias_restantes: x.c.dias,
          semaforo: x.c.semaforo,
        };
      });

    return NextResponse.json(
      successResponse({
        fecha_ref: fecha,
        dias_riesgo: DIAS_RIESGO,
        monitoreados,
        cumplimiento_pct: cumplimientoPct,
        vencidos,
        en_riesgo: enRiesgo,
        al_dia: alDia,
        pausados,
        tiempo_respuesta_ms,
        tiempo_resolucion_ms,
        // Comparación con el día anterior (mismo cálculo, corte 24 h antes).
        vs_ayer: {
          monitoreados: monitoreados - ayer.monitoreados,
          cumplimiento_pp: cumplimientoPct - ayer.cumplimiento_pct,
          vencidos: vencidos - ayer.vencidos,
          en_riesgo: enRiesgo - ayer.en_riesgo,
          respuesta_ms:
            tiempo_respuesta_ms != null && respuestaAyerMs != null
              ? tiempo_respuesta_ms - respuestaAyerMs
              : null,
          resolucion_ms:
            tiempo_resolucion_ms != null && resolucionAyerMs != null
              ? tiempo_resolucion_ms - resolucionAyerMs
              : null,
        },
        por_estado,
        por_tecnico,
        tendencia,
        criticos,
      })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
