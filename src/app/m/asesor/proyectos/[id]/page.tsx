import { resolveDataSchemaForCurrentUserServer } from "@/lib/supabase/empresa-data-server";
import { SUPABASE_APP_SCHEMA } from "@/lib/supabase/schema";
import AsesorProyectoDetalleClient from "./AsesorProyectoDetalleClient";

/**
 * Detalle de proyecto DENTRO de la app del asesor.
 *
 * Antes la tarjeta linkeaba a /dashboard/proyectos/{id} y eso te sacaba de la app: aparecía
 * el shell del dashboard con su propio menú inferior (Inicio/Ventas/Clientes/Más) y el
 * enlace "← Kanban", como si hubieras cambiado de aplicación.
 *
 * Resuelve el dataSchema igual que la página del dashboard — es lo que necesita el detalle
 * para leer del schema correcto de la empresa.
 */
export default async function MAsesorProyectoDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  let dataSchema = SUPABASE_APP_SCHEMA;
  try {
    dataSchema = await resolveDataSchemaForCurrentUserServer();
  } catch (e) {
    console.error("[m/asesor/proyectos/[id]] resolveDataSchemaForCurrentUserServer", e);
  }
  return <AsesorProyectoDetalleClient params={params} dataSchema={dataSchema} />;
}
