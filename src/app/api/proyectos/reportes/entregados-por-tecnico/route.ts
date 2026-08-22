import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { msLaborables } from "@/lib/proyectos/reloj-laboral";
import { tipoIncluyeSaas, tipoIncluyeWeb } from "@/lib/proyectos/tipos-proyecto";

/**
 * Reporte: cantidad de proyectos entregados por técnico en un mes, con el
 * tiempo que tardó cada uno en entregarse.
 *
 * Regla:
 * - "Entregado" = estado con codigo='publicado' (nombre "Publicado / Entregado").
 * - Sólo cuenta la PRIMERA vez que un proyecto entró a ese estado. Si vuelve
 *   a Entregado después de salirse, no suma otra vez.
 * - El técnico atribuido es el snapshot guardado en
 *   `proyecto_estado_historial.responsable_tecnico_id` al momento de la
 *   transición. Para entregas anteriores a esta funcionalidad, el snapshot
 *   se completó por backfill con el técnico actual del proyecto.
 * - Tiempo de entrega = horario laboral (lun-vie 8-17, sáb 8-12) entre que se
 *   le asignó el técnico y la primera entrega, menos el tiempo pausado — el
 *   mismo criterio y la misma unidad que el contador de "Tareas del equipo",
 *   para que un proyecto lea igual en los dos lugares. `pausa_acumulada_ms`
 *   es el total acumulado a HOY: si el proyecto se volvió a pausar después de
 *   entregado (una ronda de correcciones, por ejemplo), ese tiempo también se
 *   descuenta acá aunque haya ocurrido después de la entrega que se está
 *   midiendo. Es una métrica de reporte, no un SLA contractual — la
 *   distorsión es marginal y sólo aparece en proyectos con más de una ronda.
 * - Cada proyecto se clasifica en "web" / "saas" / "mixto" según su tipo. El
 *   mixto ("Página Web + SaaS/ERP") entra en el promedio de AMBOS grupos: acá
 *   no hay que evitar que una suma se duplique (como en el gráfico de
 *   entregados por mes) — son dos promedios independientes, y un proyecto
 *   mixto genuinamente fue una entrega de las dos cosas.
 *
 * Query param:
 *   ?mes=YYYY-MM (default: mes actual)
 */
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

    // 1) Estado "Entregado" (codigo='publicado') de la empresa.
    const { data: estadoEntregado, error: eEst } = await sb
      .from("proyecto_estados")
      .select("id, nombre, codigo, color")
      .eq("empresa_id", empresaId)
      .eq("codigo", "publicado")
      .maybeSingle();

    if (eEst) return NextResponse.json(errorResponse(eEst.message), { status: 400 });
    if (!estadoEntregado) {
      return NextResponse.json(
        successResponse({
          mes: mesLabel,
          desde,
          hasta,
          total: 0,
          tecnicos: [],
          estado_entregado: null,
        })
      );
    }

    const estadoEntregadoId = (estadoEntregado as { id: string }).id;

    // 2) Todo el historial de transiciones a "Entregado" para esta empresa.
    //    Pedimos ordenado ascendente para que el primer match por proyecto
    //    sea la primera entrega.
    const { data: histRows, error: eHist } = await sb
      .from("proyecto_estado_historial")
      .select("proyecto_id, entered_at, responsable_tecnico_id")
      .eq("empresa_id", empresaId)
      .eq("estado_nuevo_id", estadoEntregadoId)
      .order("entered_at", { ascending: true });

    if (eHist) return NextResponse.json(errorResponse(eHist.message), { status: 400 });

    type HistRow = {
      proyecto_id: string;
      entered_at: string;
      responsable_tecnico_id: string | null;
    };
    const rows = (histRows ?? []) as HistRow[];

    // 3) Para cada proyecto, quedarnos con la primera entrega y filtrar por mes.
    const firstByProyecto = new Map<string, HistRow>();
    for (const r of rows) {
      if (!firstByProyecto.has(r.proyecto_id)) firstByProyecto.set(r.proyecto_id, r);
    }
    const enMes: HistRow[] = [];
    for (const r of firstByProyecto.values()) {
      if (r.entered_at >= desde && r.entered_at < hasta) enMes.push(r);
    }

    if (enMes.length === 0) {
      return NextResponse.json(
        successResponse({
          mes: mesLabel,
          desde,
          hasta,
          total: 0,
          tecnicos: [],
          estado_entregado: estadoEntregado,
        })
      );
    }

    // 4) Hidratar proyectos para mostrar título + cliente + tipo + tiempos.
    const proyectoIds = enMes.map((r) => r.proyecto_id);
    const { data: proyectos } = await sb
      .from("proyectos")
      .select(
        "id, titulo, cliente_id, responsable_tecnico_id, tipo_id, tecnico_asignado_at, fecha_ingreso, pausa_acumulada_ms"
      )
      .eq("empresa_id", empresaId)
      .in("id", proyectoIds);

    type ProyectoRow = {
      id: string;
      titulo: string | null;
      cliente_id: string | null;
      responsable_tecnico_id: string | null;
      tipo_id: string | null;
      tecnico_asignado_at: string | null;
      fecha_ingreso: string | null;
      pausa_acumulada_ms: number | null;
    };
    const proyectoById = new Map<string, ProyectoRow>();
    for (const p of (proyectos ?? []) as ProyectoRow[]) proyectoById.set(p.id, p);

    // 4b) Tipos, para clasificar cada entrega en web / saas / mixto.
    const tipoIds = Array.from(
      new Set(
        (proyectos ?? [])
          .map((p) => (p as ProyectoRow).tipo_id)
          .filter((v): v is string => typeof v === "string" && v.length > 0)
      )
    );
    const tipoCodigoById = new Map<string, string>();
    if (tipoIds.length > 0) {
      const { data: tipos } = await sb
        .from("proyecto_tipos")
        .select("id, codigo")
        .eq("empresa_id", empresaId)
        .in("id", tipoIds);
      for (const t of (tipos ?? []) as { id: string; codigo: string | null }[]) {
        tipoCodigoById.set(t.id, (t.codigo ?? "").trim());
      }
    }

    type GrupoTipo = "web" | "saas" | "mixto" | "otro";
    function grupoTipoDe(proy: ProyectoRow | undefined): GrupoTipo {
      const codigo = proy?.tipo_id ? tipoCodigoById.get(proy.tipo_id) : undefined;
      const esWeb = tipoIncluyeWeb(codigo);
      const esSaas = tipoIncluyeSaas(codigo);
      if (esWeb && esSaas) return "mixto";
      if (esWeb) return "web";
      if (esSaas) return "saas";
      return "otro";
    }

    /** Horario laboral entre la asignación y la entrega, menos lo pausado a hoy. */
    function msEntregaDe(proy: ProyectoRow | undefined, entregadoAt: string): number | null {
      if (!proy) return null;
      const desde = proy.tecnico_asignado_at ?? proy.fecha_ingreso;
      const bruto = msLaborables(desde, entregadoAt);
      if (bruto == null) return null;
      const pausa = Number(proy.pausa_acumulada_ms ?? 0);
      return Math.max(0, bruto - (Number.isFinite(pausa) && pausa > 0 ? pausa : 0));
    }

    const clienteIds = Array.from(
      new Set(
        (proyectos ?? [])
          .map((p) => (p as ProyectoRow).cliente_id)
          .filter((v): v is string => typeof v === "string" && v.length > 0)
      )
    );
    const clienteNombreById = new Map<string, string>();
    if (clienteIds.length > 0) {
      const { data: clientes } = await sb
        .from("clientes")
        .select("id, empresa, nombre_contacto")
        .eq("empresa_id", empresaId)
        .in("id", clienteIds);
      for (const c of (clientes ?? []) as {
        id: string;
        empresa: string | null;
        nombre_contacto: string | null;
      }[]) {
        const label = (c.empresa ?? "").trim() || (c.nombre_contacto ?? "").trim() || "—";
        clienteNombreById.set(c.id, label);
      }
    }

    // 5) Hidratar nombres de técnicos desde el schema de catálogo (neura/zentra_erp).
    const tecnicoIds = Array.from(
      new Set(
        enMes.map((r) => r.responsable_tecnico_id).filter((v): v is string => typeof v === "string")
      )
    );
    const tecnicoNombreById = new Map<string, string>();
    if (tecnicoIds.length > 0) {
      const catalog = createServiceRoleClient();
      const { data: usuarios } = await catalog
        .from("usuarios")
        .select("id, nombre, email")
        .in("id", tecnicoIds);
      for (const u of (usuarios ?? []) as {
        id: string;
        nombre: string | null;
        email: string | null;
      }[]) {
        tecnicoNombreById.set(u.id, (u.nombre ?? "").trim() || (u.email ?? "").trim() || "—");
      }
    }

    // 6) Agrupar por técnico (snapshot del historial).
    type ProyectoReporte = {
      id: string;
      titulo: string;
      cliente: string;
      entregado_at: string;
      tipo_grupo: GrupoTipo;
      ms_entrega: number | null;
    };
    type Bucket = {
      tecnico_id: string | null;
      tecnico_nombre: string;
      cantidad: number;
      proyectos: ProyectoReporte[];
    };
    const buckets = new Map<string, Bucket>();
    for (const r of enMes) {
      const key = r.responsable_tecnico_id ?? "__SIN_TECNICO__";
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          tecnico_id: r.responsable_tecnico_id,
          tecnico_nombre: r.responsable_tecnico_id
            ? tecnicoNombreById.get(r.responsable_tecnico_id) ?? "Técnico sin nombre"
            : "Sin técnico asignado",
          cantidad: 0,
          proyectos: [],
        };
        buckets.set(key, bucket);
      }
      const proy = proyectoById.get(r.proyecto_id);
      bucket.cantidad += 1;
      bucket.proyectos.push({
        id: r.proyecto_id,
        titulo: (proy?.titulo ?? "").trim() || "(sin título)",
        cliente: (proy?.cliente_id && clienteNombreById.get(proy.cliente_id)) || "—",
        entregado_at: r.entered_at,
        tipo_grupo: grupoTipoDe(proy),
        ms_entrega: msEntregaDe(proy, r.entered_at),
      });
    }

    /** Promedio de `ms_entrega` de un subconjunto, o `null` si ninguno tiene dato medible. */
    function promedioMs(proys: ProyectoReporte[]): number | null {
      const medibles = proys.map((p) => p.ms_entrega).filter((v): v is number => typeof v === "number");
      if (medibles.length === 0) return null;
      return Math.round(medibles.reduce((a, b) => a + b, 0) / medibles.length);
    }

    // 7) Ordenar técnicos por cantidad desc (los sin técnico al final) y proyectos por fecha,
    //    y calcular el promedio de tiempo de entrega general y por tipo.
    const tecnicos = Array.from(buckets.values())
      .map((b) => {
        const proyectosOrdenados = b.proyectos
          .slice()
          .sort((a, b2) => a.entregado_at.localeCompare(b2.entregado_at));
        const web = proyectosOrdenados.filter((p) => p.tipo_grupo === "web" || p.tipo_grupo === "mixto");
        const saas = proyectosOrdenados.filter((p) => p.tipo_grupo === "saas" || p.tipo_grupo === "mixto");
        return {
          ...b,
          proyectos: proyectosOrdenados,
          promedio_ms: promedioMs(proyectosOrdenados),
          promedio_ms_web: promedioMs(web),
          promedio_ms_saas: promedioMs(saas),
          cantidad_web: web.length,
          cantidad_saas: saas.length,
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
        total: enMes.length,
        tecnicos,
        estado_entregado: estadoEntregado,
      })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
