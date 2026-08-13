import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { tipoIncluyeWeb } from "@/lib/proyectos/tipos-proyecto";

/**
 * GET /api/proyectos/paginas
 * Lista de PÁGINAS web hechas: un renglón por proyecto de tipo web (o web+SaaS), con
 * cliente/empresa, vendedor (responsable comercial), rubro (tipo_web) y acceso (dominio).
 * Sirve de catálogo interno "qué páginas ya hicimos". Incluye entregados y archivados.
 */
export async function GET(request: Request) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }
  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const empresaId = auth.empresaId;

    const { data: tiposData } = await sb
      .from("proyecto_tipos")
      .select("id, codigo")
      .eq("empresa_id", empresaId);
    const webTipoIds = (tiposData ?? [])
      .filter((t) => tipoIncluyeWeb(String((t as { codigo?: string }).codigo ?? "")))
      .map((t) => String((t as { id: string }).id));
    if (webTipoIds.length === 0) {
      return NextResponse.json(successResponse({ paginas: [] }));
    }

    const { data: proysData, error } = await sb
      .from("proyectos")
      .select("id, titulo, cliente_id, responsable_comercial_id, brief_data, created_at")
      .eq("empresa_id", empresaId)
      .in("tipo_id", webTipoIds)
      .order("created_at", { ascending: false });
    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    const proys = (proysData ?? []) as Record<string, unknown>[];

    const cliIds = [...new Set(proys.map((p) => String(p.cliente_id ?? "")).filter(Boolean))];
    const comIds = [...new Set(proys.map((p) => String(p.responsable_comercial_id ?? "")).filter(Boolean))];
    const catalog = createServiceRoleClient();
    const [cliR, comR] = await Promise.all([
      cliIds.length
        ? sb.from("clientes").select("id, empresa, nombre_contacto").eq("empresa_id", empresaId).in("id", cliIds)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      comIds.length
        ? catalog.from("usuarios").select("id, nombre").eq("empresa_id", empresaId).in("id", comIds)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    ]);
    const cliMap = new Map(
      ((cliR.data ?? []) as Record<string, unknown>[]).map((c) => [String(c.id), c] as const)
    );
    const comMap = new Map(
      ((comR.data ?? []) as Record<string, unknown>[]).map(
        (u) => [String(u.id), String((u as { nombre?: string }).nombre ?? "").trim()] as const
      )
    );

    const paginas = proys.map((p) => {
      const bd =
        p.brief_data && typeof p.brief_data === "object" && !Array.isArray(p.brief_data)
          ? (p.brief_data as Record<string, unknown>)
          : {};
      const cli = cliMap.get(String(p.cliente_id ?? "")) as
        | { empresa?: string | null; nombre_contacto?: string | null }
        | undefined;
      const cliente =
        String(cli?.empresa ?? "").trim() ||
        String(cli?.nombre_contacto ?? "").trim() ||
        String(bd.marca ?? "").trim() ||
        String(p.titulo ?? "").trim() ||
        "—";
      return {
        id: String(p.id),
        titulo: String(p.titulo ?? "").trim(),
        cliente,
        vendedor: comMap.get(String(p.responsable_comercial_id ?? "")) || "—",
        tipo_web: String(bd.tipo_web ?? "").trim(),
        dominio: String(bd.dominio_usar ?? "").trim(),
      };
    });

    return NextResponse.json(successResponse({ paginas }));
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error"), { status: 500 });
  }
}
