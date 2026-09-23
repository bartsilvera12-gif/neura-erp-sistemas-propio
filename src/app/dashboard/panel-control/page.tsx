import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/super-admin-bootstrap-email";
import { puedeEntrarAlPanelControl } from "@/lib/infra/acceso-panel-control";
import PanelControlClient from "./PanelControlClient";

/**
 * Panel de Control — estado de los servidores.
 *
 * Entran los administradores del ERP, los desarrolladores y los correos
 * habilitados a mano en `acceso-panel-control`. El permiso se comprueba acá y otra vez en
 * `/api/infra-health`: esconder el ítem del menú es visibilidad, no permiso, y
 * cualquiera que escriba la URL llegaría igual.
 */
export const dynamic = "force-dynamic";

export default async function PanelControlPage() {
  const sb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();

  let rol: string | null = null;
  let esTecnico = false;
  if (user?.email) {
    const { data } = await sb
      .from("usuarios")
      .select("rol, es_tecnico")
      .eq("email", user.email)
      .limit(1);
    const fila = data?.[0] as { rol?: string | null; es_tecnico?: boolean | null } | undefined;
    rol = fila?.rol ?? null;
    esTecnico = fila?.es_tecnico === true;
  }

  const puede =
    isBootstrapSuperAdminEmail(user?.email ?? null) ||
    puedeEntrarAlPanelControl(user?.email ?? null, rol, esTecnico);

  if (!puede) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-lg font-semibold text-slate-900">Panel de Control</h1>
        <p className="mt-2 text-sm text-slate-500">
          Esta pantalla está habilitada sólo para administradores y desarrolladores.
        </p>
      </div>
    );
  }

  return <PanelControlClient />;
}
