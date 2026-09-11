import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireGuardiasAcceso } from "@/lib/guardias/guardias-auth";
import { esLunesValido, lunesDeEstaSemana, sumarSemanas } from "@/lib/guardias/semana";

const CAMPOS = "id, semana_inicio, pm_id, soporte_principal_id, soporte_suplente_id, notas, updated_at";

/** Los tres roles de una guardia, en el orden en que se muestran. */
const ROLES = ["pm_id", "soporte_principal_id", "soporte_suplente_id"] as const;

type FilaGuardia = {
  id: string;
  semana_inicio: string;
  pm_id: string | null;
  soporte_principal_id: string | null;
  soporte_suplente_id: string | null;
  notas: string | null;
  updated_at: string | null;
};

/**
 * Los nombres de la gente asignada.
 *
 * Las guardias viven en el schema de la empresa y `usuarios` en el catálogo, así
 * que no hay join posible: se resuelven aparte, en una sola consulta para todas
 * las semanas juntas.
 */
async function conNombres(filas: FilaGuardia[]) {
  const ids = new Set<string>();
  for (const f of filas) for (const r of ROLES) if (f[r]) ids.add(f[r] as string);
  if (ids.size === 0) return filas.map((f) => ({ ...f, nombres: {} as Record<string, string> }));

  const catalog = createServiceRoleClient();
  const { data } = await catalog.from("usuarios").select("id, nombre, email").in("id", [...ids]);
  const porId = new Map<string, string>();
  for (const u of (data ?? []) as { id: string; nombre?: string | null; email?: string | null }[]) {
    porId.set(u.id, (u.nombre?.trim() || u.email?.trim() || "").trim());
  }

  return filas.map((f) => {
    const nombres: Record<string, string> = {};
    for (const r of ROLES) {
      const id = f[r];
      if (id) nombres[r] = porId.get(id) ?? "";
    }
    return { ...f, nombres };
  });
}

/**
 * GET /api/guardias
 *   · sin parámetros → la semana en curso y la siguiente (lo que muestra el modal).
 *   · ?desde=YYYY-MM-DD&semanas=N → una ventana, para la pantalla de asignación.
 *
 * Leer no pide módulo ni rol: el sentido de esto es que cualquiera sepa a quién
 * llamar un sábado.
 */
export async function GET(request: Request) {
  const auth = await requireGuardiasAcceso(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

  try {
    const url = new URL(request.url);
    const desdeParam = url.searchParams.get("desde");
    const desde = esLunesValido(desdeParam) ? desdeParam : lunesDeEstaSemana();
    const pedidas = Number(url.searchParams.get("semanas") ?? "2");
    const semanas = Number.isFinite(pedidas) ? Math.min(Math.max(Math.trunc(pedidas), 1), 26) : 2;
    const hasta = sumarSemanas(desde, semanas - 1);

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const { data, error } = await sb
      .from("guardias_semana")
      .select(CAMPOS)
      .eq("empresa_id", auth.empresaId)
      .gte("semana_inicio", desde)
      .lte("semana_inicio", hasta)
      .order("semana_inicio", { ascending: true });

    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    return NextResponse.json(
      successResponse({
        desde,
        semanas,
        es_admin: auth.esAdmin,
        guardias: await conNombres((data ?? []) as FilaGuardia[]),
      })
    );
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error"), { status: 500 });
  }
}

/**
 * PUT /api/guardias — asigna (o reasigna) una semana. Sólo administradores.
 *
 * Es un upsert por `(empresa_id, semana_inicio)`: asignar dos veces la misma
 * semana corrige la asignación en vez de crear una segunda fila que compita con
 * la primera. El índice único lo garantiza también del lado de la base.
 */
export async function PUT(request: Request) {
  const auth = await requireGuardiasAcceso(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  if (!auth.esAdmin) {
    return NextResponse.json(errorResponse("Sólo un administrador puede asignar guardias"), {
      status: 403,
    });
  }

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const semana = body?.semana_inicio;
    if (!esLunesValido(semana)) {
      return NextResponse.json(errorResponse("La semana tiene que empezar un lunes"), { status: 400 });
    }

    const persona = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    const fila = {
      empresa_id: auth.empresaId,
      semana_inicio: semana,
      pm_id: persona(body?.pm_id),
      soporte_principal_id: persona(body?.soporte_principal_id),
      soporte_suplente_id: persona(body?.soporte_suplente_id),
      notas: typeof body?.notas === "string" && body.notas.trim() ? body.notas.trim() : null,
      updated_by: auth.usuarioCatalogId,
      updated_at: new Date().toISOString(),
    };

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const { data, error } = await sb
      .from("guardias_semana")
      .upsert({ ...fila, created_by: auth.usuarioCatalogId }, { onConflict: "empresa_id,semana_inicio" })
      .select(CAMPOS);

    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    const [conNombre] = await conNombres((data ?? []) as FilaGuardia[]);
    return NextResponse.json(successResponse(conNombre ?? null));
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error"), { status: 500 });
  }
}
