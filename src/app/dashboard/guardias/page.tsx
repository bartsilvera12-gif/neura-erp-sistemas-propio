import { createSupabaseServerClient } from "@/lib/supabase/server";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/super-admin-bootstrap-email";
import GuardiasAdminClient from "./GuardiasAdminClient";

/**
 * Asignación de guardias — sólo administradores.
 *
 * El permiso se comprueba acá además de en la API. El módulo controla si el
 * ítem aparece en el menú, pero eso es visibilidad, no permiso: cualquiera que
 * escriba la URL llegaría igual. Lo que impide guardar es el chequeo del PUT;
 * esto es para que el que no puede vea por qué, en vez de una pantalla que
 * falla al apretar el botón.
 */
export default async function GuardiasPage() {
  const sb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();

  let esAdmin = isBootstrapSuperAdminEmail(user?.email ?? null);
  if (!esAdmin && user?.email) {
    const { data } = await sb.from("usuarios").select("rol").eq("email", user.email).limit(1);
    const rol = (data?.[0] as { rol?: string | null } | undefined)?.rol ?? null;
    esAdmin = esRolAdminEmpresaOGlobal(rol);
  }

  if (!esAdmin) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-lg font-semibold text-slate-900">Asignación de guardias</h1>
        <p className="mt-2 text-sm text-slate-500">
          Sólo un administrador puede asignar las guardias. Para ver quién está de turno esta
          semana, usá el botón <strong>Guardias</strong> del encabezado.
        </p>
      </div>
    );
  }

  return <GuardiasAdminClient />;
}
