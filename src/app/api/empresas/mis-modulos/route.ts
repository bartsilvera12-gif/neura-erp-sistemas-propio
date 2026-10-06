import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { getAuthUserForApiRoute } from "@/lib/auth/get-auth-user-for-api-route";
import { resolveUsuarioErpFromAuthUser } from "@/lib/auth/resolve-usuario-erp";
import { tieneAccesoMovilEspecial } from "@/lib/auth/acceso-movil-especial";
import { NextResponse } from "next/server";
import { resolveEffectiveModules } from "@/lib/modulos/resolve-effective-modules";

const MODULOS_MOVILES_ESPECIALES = [
  { id: "especial:proyectos", nombre: "Proyectos", slug: "proyectos" },
  { id: "especial:proyectos_movil", nombre: "Proyectos en la app", slug: "proyectos_movil" },
  { id: "especial:soporte", nombre: "Soporte", slug: "soporte" },
] as const;

export async function GET(request: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !anonKey || !serviceKey) {
      return NextResponse.json({ error: "Config no disponible" }, { status: 500 });
    }

    const user = await getAuthUserForApiRoute(request);
    if (!user?.id) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const supabase = createServiceRoleClient();

    const usuario = await resolveUsuarioErpFromAuthUser(supabase, user);
    if (!usuario) {
      return NextResponse.json([]);
    }

    const modulos = await resolveEffectiveModules(supabase, {
      id: usuario.id,
      empresa_id: usuario.empresa_id,
      rol: usuario.rol,
    });

    const visibles = modulos.map((m) => ({
      id: m.id,
      nombre: m.nombre,
      slug: m.slug,
    }));

    if (tieneAccesoMovilEspecial(user.email)) {
      const existentes = new Set(visibles.map((m) => (m.slug ?? "").trim().toLowerCase()));
      for (const modulo of MODULOS_MOVILES_ESPECIALES) {
        if (!existentes.has(modulo.slug)) visibles.push({ ...modulo });
      }
    }

    return NextResponse.json(visibles);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
