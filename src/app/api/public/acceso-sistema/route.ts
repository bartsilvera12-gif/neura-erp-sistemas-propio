import { NextResponse } from "next/server";
import { createServiceRoleClientWithDbSchema } from "@/lib/supabase/empresa-data-schema";
import { normalizarDominio } from "@/lib/proyectos/acceso-sistema";

/**
 * Lo consultan los ERPs de los clientes, sin sesión:
 * `GET /api/public/acceso-sistema?host=giovanni.neura.com.py` → `{ bloqueado: boolean }`.
 *
 * Bloqueado = algún proyecto con ese dominio en `acceso_dominios` está marcado
 * `acceso_suspendido` (se activa con el botón Bloquear del proyecto o de
 * Gestión de clientes). Solo devuelve el booleano: nada del cliente ni del proyecto.
 *
 * Si algo falla responde 503 y el ERP deja entrar (falla abierto).
 */
export const dynamic = "force-dynamic";

const SCHEMA = process.env.ACCESO_SISTEMA_SCHEMA?.trim() || "neura";

export async function GET(request: Request) {
  const host = normalizarDominio(new URL(request.url).searchParams.get("host"));
  if (!host) {
    return NextResponse.json({ bloqueado: false, error: "host inválido" }, { status: 400 });
  }

  try {
    const sb = createServiceRoleClientWithDbSchema(SCHEMA);
    const { data, error } = await sb
      .from("proyectos")
      .select("id")
      .contains("acceso_dominios", [host])
      .eq("acceso_suspendido", true)
      .limit(1);
    if (error) throw new Error(error.message);

    return NextResponse.json(
      { bloqueado: (data ?? []).length > 0 },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[acceso-sistema] consulta fallida", host, e instanceof Error ? e.message : e);
    return NextResponse.json({ bloqueado: false, error: "no disponible" }, { status: 503 });
  }
}
