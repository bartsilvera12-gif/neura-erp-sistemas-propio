import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Token Bearer del request en curso.
 *
 * Existe por la app nativa. Las rutas de asesor resuelven al usuario con
 * `requireEmpresaTenantServiceRole(request)`, que sí acepta Bearer — pero después llaman a
 * funciones del ERP (`fetchChatConversations`, `getMyAgentOperationalPresence`, y otras 30)
 * que vuelven a resolverlo por su cuenta leyendo cookies. Sin cookies, se caen.
 *
 * Cambiar 33 firmas para pasar el request a mano sería tocar medio módulo de chat para algo
 * que es de transporte. En vez de eso, la ruta deja el token en este contexto y el resolvedor
 * de sesión lo encuentra solo, sin que nada en el medio se entere.
 *
 * `AsyncLocalStorage` es lo correcto acá y no una variable de módulo: el valor queda atado a
 * la cadena asíncrona de ESTE request, así que dos pedidos en paralelo no se pisan.
 */
const almacen = new AsyncLocalStorage<string>();

/** Corre `fn` con el token disponible para todo lo que llame por debajo. */
export function conBearer<T>(token: string | null, fn: () => Promise<T>): Promise<T> {
  if (!token) return fn();
  return almacen.run(token, fn);
}

export function bearerDelContexto(): string | null {
  return almacen.getStore() ?? null;
}
