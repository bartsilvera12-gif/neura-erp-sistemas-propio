import { NextResponse } from "next/server";
import { getServiceAuthUsuario } from "@/lib/auth/get-service-auth-usuario";
import { resolveDataSchemaForCurrentUserServer } from "@/lib/supabase/empresa-data-server";

type UsuarioMeRow = {
  nombre: string | null;
  email: string | null;
  rol: string | null;
  es_project_manager: boolean | null;
  empresa_id: string | null;
  es_tecnico: boolean | null;
  estado: string | null;
  telefono: string | null;
  fecha_nacimiento: string | null;
  auth_user_id: string | null;
  created_at: string | null;
};

function pickAuthMetadataName(authUser: { user_metadata?: Record<string, unknown> | null }): string | null {
  const meta = authUser.user_metadata ?? {};
  const candidates = [meta.full_name, meta.name, meta.nombre];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * GET /api/usuarios/me
 *
 * Perfil mínimo para el header: resuelve el usuario autenticado server-side y
 * evita leer `usuarios` desde el navegador.
 */
export async function GET(request: Request) {
  try {
    const r = await getServiceAuthUsuario(request);
    if (!r.ok) {
      return NextResponse.json({ error: "No autenticado" }, { status: r.status });
    }

    const { authUser, catalogUsuario, supabaseSr } = r;
    let row: UsuarioMeRow | null = null;

    if (catalogUsuario?.id) {
      const { data, error } = await supabaseSr
        .from("usuarios")
        // `*` y no una lista: las columnas varían por tenant (27-sep-2026: `es_tecnico` existía
        // en 2 de 72 schemas y `es_project_manager` en 4) y pedir una que falta hace fallar
        // todo el request con 400. La respuesta de abajo solo expone los campos elegidos.
        .select("*")
        .eq("id", catalogUsuario.id)
        .maybeSingle();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      row = (data ?? null) as UsuarioMeRow | null;
    }

    const nombre = (row?.nombre ?? pickAuthMetadataName(authUser) ?? "").trim() || null;
    const email = (row?.email ?? authUser.email ?? "").trim() || null;
    const rol = (row?.rol ?? catalogUsuario?.rol ?? "").trim() || null;

    // `id` y `data_schema` los necesita la campanita: sin el id no puede filtrar
    // el canal de Realtime por destinatario, y sin el schema no sabe a qué
    // tenant suscribirse. Campos aditivos — el resto del header no los mira.
    const dataSchema = await resolveDataSchemaForCurrentUserServer().catch(() => null);

    return NextResponse.json({
      usuario: {
        id: catalogUsuario?.id ?? null,
        nombre,
        rol,
        email,
        data_schema: dataSchema,
        es_project_manager: row?.es_project_manager === true,
        // Campos de `getCurrentUser()` en el navegador (src/lib/auth.ts): el browser no
        // conoce el schema del tenant (APP_DB_SCHEMA no es NEXT_PUBLIC) y leer `usuarios`
        // directo daba 404 contra `zentra_erp`. Aditivos: el header no los usa.
        empresa_id: row?.empresa_id ?? catalogUsuario?.empresa_id ?? null,
        es_tecnico: row?.es_tecnico === true,
        estado: row?.estado ?? null,
        telefono: row?.telefono ?? null,
        fecha_nacimiento: row?.fecha_nacimiento ?? null,
        auth_user_id: row?.auth_user_id ?? null,
        created_at: row?.created_at ?? null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al obtener el usuario actual";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
