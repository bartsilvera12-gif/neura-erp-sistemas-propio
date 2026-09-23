import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getServiceAuthUsuario } from "@/lib/auth/get-service-auth-usuario";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/super-admin-bootstrap-email";
import { puedeEntrarAlPanelControl } from "@/lib/infra/acceso-panel-control";
import {
  SERVIDORES_INFRA,
  type SaludServidorItem,
} from "@/lib/infra/salud-tipos";

/**
 * GET /api/infra-health — salud de los tres servidores.
 *
 * Los datos NO se piden a ningún servicio: el colector deja un JSON por
 * servidor en una carpeta montada de sólo lectura y acá sólo se leen. Si un
 * archivo falta o vino roto, ese servidor viaja como `{ error: true }` y los
 * otros dos se muestran igual.
 *
 * Acceso: administradores del ERP, desarrolladores y los correos habilitados en
 * `acceso-panel-control`. Se comprueba acá además de en la página, porque saber
 * la URL no es un permiso.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Carpeta montada en el contenedor. Configurable por si cambia el montaje. */
const CARPETA = process.env.INFRA_HEALTH_DIR?.trim() || "/app/infra-health";

async function leerServidor(server: string): Promise<SaludServidorItem> {
  try {
    const crudo = await fs.readFile(path.join(CARPETA, `${server}.json`), "utf8");
    const json = JSON.parse(crudo) as unknown;
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      return { server, error: true };
    }
    // El nombre lo manda esta ruta, no el archivo: así la pantalla siempre
    // sabe de qué tarjeta se trata aunque el colector escriba otra cosa.
    return { ...(json as Record<string, unknown>), server } as SaludServidorItem;
  } catch {
    return { server, error: true };
  }
}

export async function GET(request: Request) {
  const sesion = await getServiceAuthUsuario(request);
  if (!sesion.ok) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const email = sesion.authUser.email ?? null;
  // `catalogUsuario` no trae `es_tecnico`: se lee aparte con el service role.
  let esTecnico = false;
  const usuarioId = sesion.catalogUsuario?.id;
  if (usuarioId) {
    const { data } = await sesion.supabaseSr
      .from("usuarios")
      .select("es_tecnico")
      .eq("id", usuarioId)
      .limit(1);
    esTecnico = (data?.[0] as { es_tecnico?: boolean | null } | undefined)?.es_tecnico === true;
  }
  const puede =
    isBootstrapSuperAdminEmail(email) ||
    puedeEntrarAlPanelControl(email, sesion.catalogUsuario?.rol ?? null, esTecnico);
  if (!puede) {
    return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
  }

  const servers = await Promise.all(SERVIDORES_INFRA.map((s) => leerServidor(s)));

  return NextResponse.json(
    { servers, now: Math.floor(Date.now() / 1000) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
