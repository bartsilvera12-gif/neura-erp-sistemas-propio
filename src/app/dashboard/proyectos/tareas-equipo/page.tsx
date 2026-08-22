import { resolveDataSchemaForCurrentUserServer } from "@/lib/supabase/empresa-data-server";
import { SUPABASE_APP_SCHEMA } from "@/lib/supabase/schema";
import TareasEquipoClient from "./TareasEquipoClient";

/**
 * Tablero "Tareas del equipo". Necesita el `dataSchema` por el modal de detalle
 * del proyecto, que es el mismo que abre el Kanban.
 */
export default async function Page() {
  let dataSchema = SUPABASE_APP_SCHEMA;
  try {
    dataSchema = await resolveDataSchemaForCurrentUserServer();
  } catch (e) {
    console.error("[proyectos/tareas-equipo] resolveDataSchemaForCurrentUserServer", e);
  }
  return <TareasEquipoClient dataSchema={dataSchema} />;
}
