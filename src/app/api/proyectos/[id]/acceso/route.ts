import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { puedeBloquearSistemas, requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import {
  normalizarDominio,
  normalizarDominios,
  ESCUCHA_VIGENCIA_DIAS,
  type AccesoSistema,
  type AccesoSistemaAccion,
} from "@/lib/proyectos/acceso-sistema";

type FilaProyecto = {
  id: string;
  acceso_dominios: string[] | null;
  acceso_suspendido: boolean | null;
  acceso_suspendido_at: string | null;
  acceso_suspendido_por: string | null;
};

const COLUMNAS = "id, acceso_dominios, acceso_suspendido, acceso_suspendido_at, acceso_suspendido_por";

async function nombreUsuario(empresaId: string, usuarioId: string | null): Promise<string | null> {
  if (!usuarioId) return null;
  try {
    const { data } = await createServiceRoleClient()
      .from("usuarios")
      .select("nombre")
      .eq("empresa_id", empresaId)
      .eq("id", usuarioId)
      .maybeSingle();
    return ((data as { nombre?: string | null } | null)?.nombre ?? "").trim() || null;
  } catch {
    return null;
  }
}

/** Hosts de las credenciales del proyecto que no estén ya cargados. */
async function sugeridos(
  sb: Awaited<ReturnType<typeof getChatServiceClientForEmpresa>>,
  empresaId: string,
  proyectoId: string,
  yaCargados: string[]
): Promise<string[]> {
  const { data } = await sb
    .from("proyecto_credenciales")
    .select("url")
    .eq("empresa_id", empresaId)
    .eq("proyecto_id", proyectoId);
  const out: string[] = [];
  for (const r of (data ?? []) as { url?: string | null }[]) {
    const d = normalizarDominio(r.url);
    if (d && !yaCargados.includes(d) && !out.includes(d)) out.push(d);
  }
  return out;
}

/**
 * ¿Alguno de los dominios consultó su estado hace poco? Lo anota el endpoint
 * público (neura.acceso_sistema_consultas). `null` si no se pudo leer.
 */
async function escuchaElBoton(
  sb: Awaited<ReturnType<typeof getChatServiceClientForEmpresa>>,
  dominios: string[]
): Promise<boolean | null> {
  if (dominios.length === 0) return false;
  try {
    const desde = new Date(Date.now() - ESCUCHA_VIGENCIA_DIAS * 86_400_000).toISOString();
    const { data, error } = await sb
      .from("acceso_sistema_consultas")
      .select("host")
      .in("host", dominios)
      .gte("ultima_consulta", desde)
      .limit(1);
    if (error) return null;
    return (data ?? []).length > 0;
  } catch {
    return null;
  }
}

async function armarRespuesta(
  sb: Awaited<ReturnType<typeof getChatServiceClientForEmpresa>>,
  empresaId: string,
  fila: FilaProyecto,
  puedeGestionar: boolean
): Promise<AccesoSistema> {
  const dominios = fila.acceso_dominios ?? [];
  const suspendido = fila.acceso_suspendido === true;
  const [porNombre, sug, escucha] = await Promise.all([
    suspendido ? nombreUsuario(empresaId, fila.acceso_suspendido_por) : Promise.resolve(null),
    sugeridos(sb, empresaId, fila.id, dominios),
    escuchaElBoton(sb, dominios),
  ]);
  return {
    dominios,
    suspendido,
    suspendido_at: suspendido ? fila.acceso_suspendido_at : null,
    suspendido_por_nombre: porNombre,
    sugeridos: sug,
    puede_gestionar: puedeGestionar,
    escucha,
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });

  const { id } = await params;
  const pid = id?.trim() ?? "";
  if (!pid) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const { data, error } = await sb
      .from("proyectos")
      .select(COLUMNAS)
      .eq("empresa_id", auth.empresaId)
      .eq("id", pid)
      .maybeSingle();
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    if (!data) return NextResponse.json(errorResponse("Proyecto no encontrado"), { status: 404 });

    const body = await armarRespuesta(sb, auth.empresaId, data as FilaProyecto, puedeBloquearSistemas(auth));
    return NextResponse.json(successResponse(body));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * `{ accion: "bloquear" | "desbloquear" | "dominios", dominios?: string[] }`.
 *
 * Solo admin de empresa / super admin. Bloquear exige al menos un dominio: sin
 * dominio ningún ERP se daría por aludido y el botón no haría nada.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  if (!puedeBloquearSistemas(auth)) {
    return NextResponse.json(errorResponse("Solo un administrador o Ivan pueden bloquear o desbloquear sistemas"), {
      status: 403,
    });
  }

  const { id } = await params;
  const pid = id?.trim() ?? "";
  if (!pid) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

  const body = (await request.json().catch(() => null)) as { accion?: unknown; dominios?: unknown } | null;
  const accion = body?.accion as AccesoSistemaAccion | undefined;
  if (accion !== "bloquear" && accion !== "desbloquear" && accion !== "dominios") {
    return NextResponse.json(errorResponse("accion inválida"), { status: 400 });
  }

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const { data: actual, error: errActual } = await sb
      .from("proyectos")
      .select(COLUMNAS)
      .eq("empresa_id", auth.empresaId)
      .eq("id", pid)
      .maybeSingle();
    if (errActual) return NextResponse.json(errorResponse(errActual.message), { status: 400 });
    if (!actual) return NextResponse.json(errorResponse("Proyecto no encontrado"), { status: 404 });

    const fila = actual as FilaProyecto;
    const dominios = body && "dominios" in body ? normalizarDominios(body.dominios) : fila.acceso_dominios ?? [];
    const ahora = new Date().toISOString();
    const patch: Record<string, unknown> = { acceso_dominios: dominios, updated_by: auth.usuarioCatalogId };

    if (accion === "bloquear") {
      if (dominios.length === 0) {
        return NextResponse.json(
          errorResponse("Cargá al menos un dominio del sistema (ej. cliente.neura.com.py) antes de bloquear"),
          { status: 400 }
        );
      }
      if ((await escuchaElBoton(sb, dominios)) === false) {
        return NextResponse.json(
          errorResponse(
            "Este sistema todavía no tiene el bloqueo con botón: la primera vez hay que activarlo por código."
          ),
          { status: 409 }
        );
      }
      patch.acceso_suspendido = true;
      patch.acceso_suspendido_at = ahora;
      patch.acceso_suspendido_por = auth.usuarioCatalogId;
    } else if (accion === "desbloquear") {
      patch.acceso_suspendido = false;
      patch.acceso_suspendido_at = null;
      patch.acceso_suspendido_por = null;
    }

    const { data, error } = await sb
      .from("proyectos")
      .update(patch)
      .eq("empresa_id", auth.empresaId)
      .eq("id", pid)
      .select(COLUMNAS)
      .maybeSingle();
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    if (!data) return NextResponse.json(errorResponse("Proyecto no encontrado"), { status: 404 });

    // El registro es para auditoría: si falla no se deshace el bloqueo.
    const { error: errEvento } = await sb.from("proyecto_acceso_eventos").insert({
      empresa_id: auth.empresaId,
      proyecto_id: pid,
      accion,
      dominios,
      usuario_id: auth.usuarioCatalogId,
    });
    if (errEvento) console.error("[acceso-sistema] no se pudo registrar el evento", errEvento.message);

    const resp = await armarRespuesta(sb, auth.empresaId, data as FilaProyecto, true);
    return NextResponse.json(successResponse(resp));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
