import { createSupabaseServerClient } from "@/lib/supabase/server";
import { puedeVerPanelControl } from "@/lib/infra/acceso-panel-control";
import PanelControlClient from "./PanelControlClient";

/**
 * Panel de Control — estado de los servidores.
 *
 * El permiso se comprueba acá y otra vez en `/api/infra-health`: esconder el
 * ítem del menú es visibilidad, no permiso, y cualquiera que escriba la URL
 * llegaría igual. Sin el correo habilitado no se renderiza la pantalla ni se
 * responde un solo dato.
 */
export const dynamic = "force-dynamic";

export default async function PanelControlPage() {
  const sb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!puedeVerPanelControl(user?.email ?? null)) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-lg font-semibold text-slate-900">Panel de Control</h1>
        <p className="mt-2 text-sm text-slate-500">
          Esta pantalla está habilitada sólo para algunos usuarios.
        </p>
      </div>
    );
  }

  return <PanelControlClient />;
}
