import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/super-admin-bootstrap-email";
import { puedeEntrarAlPanelControl } from "@/lib/infra/acceso-panel-control";
import PanelControlClient from "./PanelControlClient";

/**
 * Panel de Control — estado de los servidores.
 *
 * Entran los administradores del ERP y los correos habilitados a mano en
 * `acceso-panel-control`. El permiso se comprueba acá y otra vez en
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
  if (user?.email) {
    const { data } = await sb.from("usuarios").select("rol").eq("email", user.email).limit(1);
    rol = (data?.[0] as { rol?: string | null } | undefined)?.rol ?? null;
  }

  const puede =
    isBootstrapSuperAdminEmail(user?.email ?? null) ||
    puedeEntrarAlPanelControl(user?.email ?? null, rol);

  if (!puede) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-lg font-semibold text-slate-900">Panel de Control</h1>
        <p className="mt-2 text-sm text-slate-500">
          Esta pantalla está habilitada sólo para administradores.
        </p>
      </div>
    );
  }

  return <PanelControlClient />;
}
