import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { enrichProyectosRows } from "@/lib/proyectos/enrich-proyectos";
import { insertHistorialCambioEstado } from "@/lib/proyectos/historial-actions";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { coincideBusqueda, tokenizarBusqueda } from "@/lib/proyectos/busqueda";

const PRIORIDADES = new Set(["baja", "normal", "alta", "urgente"]);

export async function GET(request: Request) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  try {
    const sp = new URL(request.url).searchParams;
    const estadoId = sp.get("estado_id");
    const tipoId = sp.get("tipo_id");
    const prioridad = sp.get("prioridad");
    const rc = sp.get("responsable_comercial_id");
    const rt = sp.get("responsable_tecnico_id");
    const clienteId = sp.get("cliente_id");
    const archivado = sp.get("archivado") === "1";
    const qRaw = sp.get("q");

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const empresaId = auth.empresaId;

    function proyectosFiltrados() {
      let qq = sb.from("proyectos").select("*").eq("empresa_id", empresaId).eq("archivado", archivado);
      if (estadoId) qq = qq.eq("estado_id", estadoId);
      if (tipoId) qq = qq.eq("tipo_id", tipoId);
      if (prioridad && PRIORIDADES.has(prioridad)) qq = qq.eq("prioridad", prioridad);
      if (rc) qq = qq.eq("responsable_comercial_id", rc);
      if (rt) qq = qq.eq("responsable_tecnico_id", rt);
      if (clienteId) qq = qq.eq("cliente_id", clienteId);
      return qq;
    }

    let rows: Record<string, unknown>[] = [];

    const q = qRaw?.trim();
    if (!q) {
      const { data, error } = await proyectosFiltrados().order("last_activity_at", { ascending: false });
      if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
      rows = (data ?? []) as Record<string, unknown>[];
    } else {
      // Búsqueda: proyectos cuyo título matchea, o cuyo cliente (empresa /
      // contacto) matchea. Traemos proyectos y clientes con los filtros base en
      // DOS queries y cruzamos en memoria. Evita armar `.in(id/cliente_id, [...])`
      // con cientos de UUIDs, que genera una URL enorme que el gateway rechaza
      // (URI too long → página HTML de error). Los proyectos por empresa son
      // acotados, así que filtrar en memoria es barato y seguro.
      //
      // El match usa el mismo normalizador que los tableros y NO `ilike`: en
      // Postgres `ilike` distingue acentos, así que "marilia" no encontraba a
      // "MARÍLIA", y al ser un substring único "karen web" no encontraba nada.
      const tokens = tokenizarBusqueda(q);
      const [cli, todos] = await Promise.all([
        sb.from("clientes").select("id, empresa, nombre_contacto").eq("empresa_id", empresaId),
        proyectosFiltrados().order("last_activity_at", { ascending: false }),
      ]);

      if (todos.error) {
        return NextResponse.json(errorResponse(todos.error.message), { status: 400 });
      }

      // Texto del cliente por id, para no re-armarlo en cada proyecto.
      const textoCliente = new Map<string, string>();
      for (const c of (cli.data ?? []) as { id: string; empresa?: string; nombre_contacto?: string }[]) {
        textoCliente.set(c.id, [c.empresa, c.nombre_contacto].filter(Boolean).join(" "));
      }

      rows = ((todos.data ?? []) as Record<string, unknown>[]).filter((r) => {
        const titulo = typeof r.titulo === "string" ? r.titulo : "";
        const cid = typeof r.cliente_id === "string" ? r.cliente_id : "";
        return coincideBusqueda(tokens, `${titulo} ${textoCliente.get(cid) ?? ""}`);
      });
    }

    // "Mi vista": solo los proyectos donde el usuario actual es responsable —
    // pero en SU función, no en cualquiera.
    //
    // No hay ningún campo en `usuarios` que diga "sos comercial" o "sos
    // técnico" (`rol` es el permiso del ERP, no el puesto; `area`/`nivel` no
    // se usan de forma consistente para esto — hay técnicos con area="ventas").
    // La única fuente confiable es en qué campo aparece asignado de verdad: si
    // tiene proyectos activos como `responsable_tecnico_id`, funciona como
    // técnico acá, y "Mías" filtra sólo por ese campo — no también por si
    // alguna vez apareció como comercial en otro proyecto.
    //
    // Si la persona tiene asignaciones en más de una función (raro — hoy sólo
    // pasa con un administrador) o en ninguna todavía, se cae al criterio
    // anterior (cualquiera de los tres campos), para no dejarla con la vista
    // vacía mientras no se sepa cuál es "su" función.
    if (sp.get("mios") === "1") {
      const yo = auth.usuarioCatalogId ?? "";
      if (!yo) {
        rows = [];
      } else {
        const contarPor = (campo: "responsable_tecnico_id" | "responsable_comercial_id" | "qa_responsable_id") =>
          sb
            .from("proyectos")
            .select("id", { count: "exact", head: true })
            .eq("empresa_id", empresaId)
            .eq("archivado", false)
            .eq(campo, yo);

        const [cTecnico, cComercial, cQa] = await Promise.all([
          contarPor("responsable_tecnico_id"),
          contarPor("responsable_comercial_id"),
          contarPor("qa_responsable_id"),
        ]);
        const esTecnico = (cTecnico.count ?? 0) > 0;
        const esComercial = (cComercial.count ?? 0) > 0;
        const esQa = (cQa.count ?? 0) > 0;
        const funcionUnica = [esTecnico, esComercial, esQa].filter(Boolean).length === 1;

        rows = rows.filter((r) => {
          const rcid = typeof r.responsable_comercial_id === "string" ? r.responsable_comercial_id : "";
          const rtid = typeof r.responsable_tecnico_id === "string" ? r.responsable_tecnico_id : "";
          const qaid = typeof r.qa_responsable_id === "string" ? r.qa_responsable_id : "";
          if (funcionUnica) {
            if (esTecnico) return rtid === yo;
            if (esComercial) return rcid === yo;
            return qaid === yo;
          }
          return rcid === yo || rtid === yo || qaid === yo;
        });
      }
    }

    const enriched = await enrichProyectosRows(sb, empresaId, rows);

    // Badge de novedades de QA: una sola query agregada para todo el listado
    // (las no leídas del usuario actual), no una por proyecto. El estado de
    // lectura es por usuario, así que dos personas ven badges distintos sobre
    // las mismas filas.
    const { data: noLeidas } = await sb
      .from("usuario_notificaciones")
      .select("proyecto_id, agrupadas")
      .eq("empresa_id", empresaId)
      .eq("usuario_id", auth.usuarioCatalogId)
      .is("leida_at", null)
      .not("proyecto_id", "is", null);

    const porProyecto = new Map<string, number>();
    for (const n of (noLeidas ?? []) as { proyecto_id: string; agrupadas: number | null }[]) {
      const previo = porProyecto.get(n.proyecto_id) ?? 0;
      porProyecto.set(n.proyecto_id, previo + Number(n.agrupadas ?? 1));
    }

    const conBadge = enriched.map((p) => {
      const pid = typeof p.id === "string" ? p.id : "";
      return { ...p, qa_novedades_no_leidas: porProyecto.get(pid) ?? 0 };
    });

    return NextResponse.json(successResponse(conBadge));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json(errorResponse("Body inválido"), { status: 400 });
    }

    const titulo = typeof body.titulo === "string" ? body.titulo.trim() : "";
    const tipoId = typeof body.tipo_id === "string" ? body.tipo_id : "";
    if (!titulo || !tipoId) {
      return NextResponse.json(errorResponse("titulo y tipo_id son obligatorios"), { status: 400 });
    }

    const prioridadRaw = typeof body.prioridad === "string" ? body.prioridad : "normal";
    const prioridad = PRIORIDADES.has(prioridadRaw) ? prioridadRaw : "normal";

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const empresaId = auth.empresaId;

    let estadoId = typeof body.estado_id === "string" ? body.estado_id : "";
    if (!estadoId) {
      const { data: ini, error: eIni } = await sb
        .from("proyecto_estados")
        .select("id")
        .eq("empresa_id", empresaId)
        .eq("es_estado_inicial", true)
        .eq("activo", true)
        .limit(1)
        .maybeSingle();
      if (eIni) return NextResponse.json(errorResponse(eIni.message), { status: 400 });
      estadoId = (ini as { id?: string } | null)?.id ?? "";
    }
    if (!estadoId) {
      return NextResponse.json(errorResponse("No hay estado inicial configurado"), { status: 400 });
    }

    const { data: estRow, error: eEst } = await sb
      .from("proyecto_estados")
      .select("id, tipo_sla")
      .eq("empresa_id", empresaId)
      .eq("id", estadoId)
      .maybeSingle();
    if (eEst || !estRow) {
      return NextResponse.json(errorResponse("Estado no válido"), { status: 400 });
    }

    const tipoSla = String((estRow as { tipo_sla?: string }).tipo_sla ?? "interno");

    const clienteId =
      typeof body.cliente_id === "string" && body.cliente_id ? body.cliente_id : null;

    const brief_data =
      body.brief_data && typeof body.brief_data === "object" && !Array.isArray(body.brief_data)
        ? body.brief_data
        : {};
    const metadata =
      body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? body.metadata
        : {};

    const insert: Record<string, unknown> = {
      empresa_id: empresaId,
      cliente_id: clienteId,
      tipo_id: tipoId,
      estado_id: estadoId,
      titulo,
      descripcion: typeof body.descripcion === "string" ? body.descripcion : null,
      prioridad,
      responsable_comercial_id:
        typeof body.responsable_comercial_id === "string" ? body.responsable_comercial_id : null,
      responsable_tecnico_id:
        typeof body.responsable_tecnico_id === "string" ? body.responsable_tecnico_id : null,
      fecha_ingreso:
        typeof body.fecha_ingreso === "string" && body.fecha_ingreso
          ? body.fecha_ingreso
          : new Date().toISOString(),
      fecha_prometida:
        typeof body.fecha_prometida === "string" && body.fecha_prometida
          ? body.fecha_prometida
          : null,
      monto_vendido:
        body.monto_vendido === null || body.monto_vendido === undefined
          ? null
          : Number(body.monto_vendido),
      observaciones_comerciales:
        typeof body.observaciones_comerciales === "string" ? body.observaciones_comerciales : null,
      brief_data,
      metadata,
      bloqueado: body.bloqueado === true,
      bloqueo_motivo: typeof body.bloqueo_motivo === "string" ? body.bloqueo_motivo : null,
      created_by: auth.usuarioCatalogId,
      updated_by: auth.usuarioCatalogId,
      ultimo_movimiento_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      // Arranque del contador de días del tablero "Tareas del equipo": corre
      // desde que el proyecto tiene programador asignado.
      tecnico_asignado_at:
        typeof body.responsable_tecnico_id === "string" && body.responsable_tecnico_id
          ? new Date().toISOString()
          : null,
    };

    const { data: created, error: insErr } = await sb.from("proyectos").insert(insert).select("*");
    if (insErr || created == null) {
      return NextResponse.json(errorResponse(insErr?.message ?? "No se pudo crear"), { status: 400 });
    }

    const row = (Array.isArray(created) ? created[0] : created) as Record<string, unknown>;
    const proyectoId = row.id as string;

    await insertHistorialCambioEstado({
      sb,
      empresaId,
      proyectoId,
      estadoAnteriorId: null,
      estadoNuevoId: estadoId,
      tipoSlaSnapshot: tipoSla,
      changedBy: auth.usuarioCatalogId,
      responsableTecnicoId: (insert.responsable_tecnico_id as string | null) ?? null,
    });

    const enriched = await enrichProyectosRows(sb, empresaId, [row]);
    return NextResponse.json(successResponse(enriched[0] ?? row));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
