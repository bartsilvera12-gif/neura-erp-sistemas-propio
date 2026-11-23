import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/middleware/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { registrarHistorialCliente } from "@/lib/clientes/historial";
import {
  BloqueoNoInstalado,
  escribirBloqueoErp,
  leerBloqueoErp,
  resolverInstanciaErpDeCliente,
} from "@/lib/clientes/acceso-erp-servidor";

/** Además de los administradores, Juliana Contreras puede operar el bloqueo (decisión del dueño). */
const EMAILS_EXTRA = new Set(["julicontreras1912@gmail.com"]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function puedeOperar(auth: any): boolean {
  if (isAdmin(auth)) return true;
  const email = typeof auth?.user?.email === "string" ? auth.user.email.toLowerCase() : "";
  return EMAILS_EXTRA.has(email);
}

/**
 * GET /api/clientes/:id/acceso-erp
 * Estado del bloqueo: si el cliente tiene instancia de ERP resuelta, su schema,
 * si el bloqueo está instalado en ese schema, y si está suspendido ahora.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { auth, supabase } = ctx;

    const { id: clienteId } = await params;
    if (!clienteId) return NextResponse.json(errorResponse("id es obligatorio"), { status: 400 });

    const { data: cliente } = await supabase
      .from("clientes")
      .select("id")
      .eq("id", clienteId)
      .eq("empresa_id", auth.empresa_id)
      .is("deleted_at", null)
      .single();
    if (!cliente) return NextResponse.json(errorResponse("Cliente no encontrado"), { status: 404 });

    const inst = await resolverInstanciaErpDeCliente(supabase, auth.empresa_id, clienteId);
    if (!inst) {
      return NextResponse.json(successResponse({ tiene_instancia: false, puede_operar: puedeOperar(auth) }));
    }

    let instalado = true;
    let suspendido: boolean | null = null;
    try {
      suspendido = await leerBloqueoErp(inst.schema);
    } catch (e) {
      if (e instanceof BloqueoNoInstalado) instalado = false;
      else throw e;
    }

    return NextResponse.json(successResponse({
      tiene_instancia: true,
      schema: inst.schema,
      instalado,
      suspendido,
      puede_operar: puedeOperar(auth),
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * POST /api/clientes/:id/acceso-erp
 * Bloquea o habilita el acceso al ERP del cliente.
 * Body: { accion: "bloquear" | "habilitar", motivo?: string }  (motivo obligatorio al bloquear)
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { auth, supabase } = ctx;

    if (!puedeOperar(auth)) {
      return NextResponse.json(errorResponse("No tenés permiso para bloquear o habilitar el acceso al ERP."), { status: 403 });
    }

    const { id: clienteId } = await params;
    if (!clienteId) return NextResponse.json(errorResponse("id es obligatorio"), { status: 400 });

    const body = await request.json().catch(() => ({}));
    const accion = body?.accion === "bloquear" ? "bloquear" : body?.accion === "habilitar" ? "habilitar" : null;
    const motivo = typeof body?.motivo === "string" ? body.motivo.trim() : "";
    if (!accion) {
      return NextResponse.json(errorResponse('accion debe ser "bloquear" o "habilitar".'), { status: 400 });
    }
    if (accion === "bloquear" && !motivo) {
      return NextResponse.json(errorResponse("El motivo es obligatorio para bloquear."), { status: 400 });
    }

    const { data: cliente } = await supabase
      .from("clientes")
      .select("id")
      .eq("id", clienteId)
      .eq("empresa_id", auth.empresa_id)
      .is("deleted_at", null)
      .single();
    if (!cliente) return NextResponse.json(errorResponse("Cliente no encontrado"), { status: 404 });

    const inst = await resolverInstanciaErpDeCliente(supabase, auth.empresa_id, clienteId);
    if (!inst) {
      return NextResponse.json(
        errorResponse("Este cliente no tiene una instancia de ERP resuelta. Verificá su credencial en Proyectos."),
        { status: 400 }
      );
    }

    const suspendido = accion === "bloquear";
    try {
      await escribirBloqueoErp(inst.schema, suspendido, motivo || null);
    } catch (e) {
      if (e instanceof BloqueoNoInstalado) {
        return NextResponse.json(errorResponse(e.message), { status: 409 });
      }
      throw e;
    }

    await registrarHistorialCliente(supabase, {
      empresaId: auth.empresa_id,
      clienteId: String(clienteId),
      accion: suspendido ? "erp_acceso_bloqueado" : "erp_acceso_habilitado",
      detalle: {
        motivo: suspendido ? motivo : motivo || null,
        schema: inst.schema,
        por_nombre: auth.nombre ?? null,
      },
      authUserId: auth.user?.id ?? null,
      email: typeof auth.user?.email === "string" ? auth.user.email : null,
      source: "clientes_ui",
    });

    return NextResponse.json(successResponse({ suspendido }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
