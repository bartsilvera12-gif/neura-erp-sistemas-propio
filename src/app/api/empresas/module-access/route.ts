import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { getAuthUserForApiRoute, redactarMensajeDiagnostico } from "@/lib/auth/get-auth-user-for-api-route";
import { resolveUsuarioErpFromAuthUser } from "@/lib/auth/resolve-usuario-erp";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/super-admin-bootstrap-email";
import { NextResponse } from "next/server";
import { resolveEffectiveModules } from "@/lib/modulos/resolve-effective-modules";
import { isQaOnlyMode } from "@/lib/qa/qa-only-gate";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveQaAccess } from "@/lib/qa/authorize";

/**
 * Slugs de módulos efectivos para el usuario autenticado (intersección empresa ∩ usuario).
 * super_admin → todos los slugs del catálogo.
 *
 * BIFURCACIÓN:
 *   - En producción (QA_ONLY_MODE ausente): comportamiento original, con service_role.
 *   - En QA-only (QA_ONLY_MODE === "true"): stub cookie-scoped que delega en
 *     `resolveQaAccess`. No usa SERVICE_ROLE_KEY. Devuelve únicamente el slug
 *     `qa_center` si el usuario pasa el gate; en caso contrario slugs vacíos.
 *     No otorga ningún permiso ficticio: resolveQaAccess exige empresa Neura,
 *     módulo activo y asignación individual (o super_admin global).
 */
export async function GET(request: Request) {
  if (isQaOnlyMode()) {
    return handleQaOnly(request);
  }
  return handleProduction(request);
}

async function handleQaOnly(request: Request): Promise<NextResponse> {
  try {
    const user = await getAuthUserForApiRoute(request);
    if (!user?.id || !user.email) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    const sb = await createSupabaseServerClient();
    const decision = await resolveQaAccess(sb, user.email);
    if (!decision.ok) {
      return NextResponse.json({
        superAdmin: false,
        rol: null,
        slugs: [],
        modulos: [],
      });
    }
    // super_admin → mantenemos superAdmin:true por si AuthGuard enruta por eso,
    // pero sin exponer el catálogo completo: en QA-only ese catálogo no corre.
    if (decision.reason === "super_admin") {
      return NextResponse.json({
        superAdmin: true,
        rol: "super_admin",
        slugs: ["qa_center"],
        modulos: [{ id: null, nombre: "QA Center", slug: "qa_center" }],
      });
    }
    return NextResponse.json({
      superAdmin: false,
      rol: null,
      slugs: ["qa_center"],
      modulos: [{ id: null, nombre: "QA Center", slug: "qa_center" }],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error";
    console.error("[module-access][qa-only] 500", { msg: redactarMensajeDiagnostico(msg) });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function handleProduction(request: Request): Promise<NextResponse> {
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
      if (isBootstrapSuperAdminEmail(user.email)) {
        const modulos = await resolveEffectiveModules(supabase, {
          id: user.id,
          empresa_id: null,
          rol: "super_admin",
        });
        return NextResponse.json({
          superAdmin: true,
          slugs: modulos.map((m) => m.slug).filter(Boolean),
          modulos: modulos.map((m) => ({ id: m.id, nombre: m.nombre, slug: m.slug })),
        });
      }
      return NextResponse.json({ superAdmin: false, slugs: [], modulos: [] });
    }

    const modulos = await resolveEffectiveModules(supabase, {
      id: usuario.id,
      empresa_id: usuario.empresa_id,
      rol: usuario.rol,
    });

    const superAdmin = (usuario.rol ?? "").trim() === "super_admin";

    return NextResponse.json({
      superAdmin,
      // El menu necesita distinguir "admin de empresa" de "super admin" para
      // los items reservados a administracion; sin esto tendria que pedir el
      // usuario por separado.
      rol: usuario.rol ?? null,
      slugs: modulos.map((m) => m.slug).filter(Boolean),
      modulos: modulos.map((m) => ({ id: m.id, nombre: m.nombre, slug: m.slug })),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error";
    // Diagnóstico temporal (27-sep-2026): este 500 dispara el rebote a /login en la app nueva.
    console.error("[module-access] 500", { msg: redactarMensajeDiagnostico(msg) });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
