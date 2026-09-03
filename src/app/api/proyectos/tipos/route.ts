import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { TIPO_PROYECTO_WEB_SAAS } from "@/lib/proyectos/tipos-proyecto";

const DEFAULT_PROYECTO_TIPOS = [
  { nombre: "Proyecto Web", codigo: "web", descripcion: "Sitios y landings vendidos por comercial" },
  { nombre: "SaaS / ERP", codigo: "saas", descripcion: "Implementaciones SaaS y ERP para clientes" },
  {
    nombre: "Página Web + SaaS / ERP",
    codigo: TIPO_PROYECTO_WEB_SAAS,
    descripcion: "Proyecto mixto: sitio web e implementación SaaS/ERP para el mismo cliente",
  },
] as const;

export async function GET(request: Request) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    const leerTipos = () =>
      sb
        .from("proyecto_tipos")
        .select("id, nombre, codigo, descripcion, config, activo")
        .eq("empresa_id", auth.empresaId)
        .eq("activo", true)
        .order("nombre", { ascending: true });

    // Antes se hacían 3 upserts EN CADA GET (3 writes serializados por carga de
    // tablero) para datos que casi nunca cambian. Ahora el camino normal es una
    // sola lectura; sólo la primera vez (cuando el tenant no tiene tipos) se
    // siembran los defaults.
    let { data, error } = await leerTipos();
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    if (!data || data.length === 0) {
      for (const tipo of DEFAULT_PROYECTO_TIPOS) {
        const { error: seedError } = await sb.from("proyecto_tipos").upsert(
          {
            empresa_id: auth.empresaId,
            nombre: tipo.nombre,
            codigo: tipo.codigo,
            descripcion: tipo.descripcion,
            activo: true,
          },
          { onConflict: "empresa_id,codigo", ignoreDuplicates: true }
        );
        if (seedError) {
          return NextResponse.json(errorResponse(seedError.message), { status: 400 });
        }
      }
      ({ data, error } = await leerTipos());
      if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    }

    return NextResponse.json(successResponse(data ?? []));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
