import { resolveDataSchemaForCurrentUserServer } from "@/lib/supabase/empresa-data-server";
import { SUPABASE_APP_SCHEMA } from "@/lib/supabase/schema";
import TareasEquipoClient from "../tareas-equipo/TareasEquipoClient";

/**
 * "Proyectos por comercial": el mismo tablero del equipo, agrupado por asesor
 * comercial en vez de por programador. Comparte el cliente con
 * /dashboard/proyectos/tareas-equipo (misma tarjeta y misma fila) y se
 * diferencia por el prop `pantalla`.
 */
export default async function Page() {
  let dataSchema = SUPABASE_APP_SCHEMA;
  try {
    dataSchema = await resolveDataSchemaForCurrentUserServer();
  } catch (e) {
    console.error("[proyectos/comercial] resolveDataSchemaForCurrentUserServer", e);
  }
  return <TareasEquipoClient dataSchema={dataSchema} pantalla="comercial" />;
}
