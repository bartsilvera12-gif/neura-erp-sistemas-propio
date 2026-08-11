import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";

// Proyectos de la empresa con al menos una observación cargada, para poblar el
// selector "Clonar observaciones desde…". Mismo patrón que la ruta homónima
// del checklist (`qa/proyectos-disponibles`), que mira `proyecto_qa_grupos`.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

  const { id } = await params;
  const pid = id?.trim() ?? "";
  if (!pid) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const { data: obsRaw, error: errO } = await sb
      .from("proyecto_qa_observaciones")
      .select("proyecto_id")
      .eq("empresa_id", auth.empresaId);
    if (errO) return NextResponse.json(errorResponse(errO.message), { status: 400 });

    const ids = Array.from(
      new Set(((obsRaw ?? []) as Array<{ proyecto_id: string }>).map((o) => o.proyecto_id))
    ).filter((x) => x !== pid);

    if (ids.length === 0) return NextResponse.json(successResponse([]));

    const { data, error } = await sb
      .from("proyectos")
      .select("id, titulo")
      .eq("empresa_id", auth.empresaId)
      .in("id", ids)
      .order("titulo", { ascending: true });
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    return NextResponse.json(successResponse(data ?? []));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
