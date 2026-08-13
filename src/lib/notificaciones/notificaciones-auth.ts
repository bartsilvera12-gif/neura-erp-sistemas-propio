import "server-only";
import { getServiceAuthUsuario } from "@/lib/auth/get-service-auth-usuario";

/**
 * Auth de las rutas de notificaciones.
 *
 * A diferencia del resto del módulo, acá NO se exige el módulo Proyectos
 * (`requireProyectosApiAccess`): la campanita es del header, la ve todo el ERP,
 * y hay destinatarios legítimos que no tienen Proyectos habilitado — la project
 * manager recibe el aviso de "QA aprobó" sin necesariamente poder abrir el
 * tablero. Exigir el módulo la dejaría con un 403 en el header.
 *
 * El aislamiento no se relaja por eso: `usuarioId` y `empresaId` salen de la
 * sesión, y todas las queries filtran por ambos. Un usuario nunca puede pedir
 * las notificaciones de otro porque el destinatario no viaja en el request.
 */
export type NotificacionesAuth =
  | { ok: true; empresaId: string; usuarioId: string }
  | { ok: false; status: number; message: string };

export async function requireNotificacionesAccess(
  request: Request
): Promise<NotificacionesAuth> {
  const r = await getServiceAuthUsuario(request);
  if (!r.ok) return { ok: false, status: 401, message: "No autenticado" };

  const usuario = r.catalogUsuario;
  if (!usuario?.id || !usuario.empresa_id) {
    return { ok: false, status: 403, message: "Usuario sin empresa" };
  }

  return { ok: true, empresaId: usuario.empresa_id, usuarioId: usuario.id };
}
