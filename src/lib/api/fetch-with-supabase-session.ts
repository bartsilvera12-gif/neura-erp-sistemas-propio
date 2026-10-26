import { serializeUnknownError } from "@/lib/errors/serialize-unknown-error";
import { supabase } from "@/lib/supabase";

/** Margen antes del vencimiento: un token que muere en el camino es un 401 igual. */
const MARGEN_VENCIMIENTO_SEG = 60;

/**
 * El JWT para hablar con nuestras rutas.
 *
 * Antes devolvía lo que hubiera guardado, vencido o no. En la app —que queda abierta
 * días— eso significaba mandar un token muerto una y otra vez: el servidor contestaba
 * "Iniciá sesión", la pantalla mostraba el cartel en rojo y la asesora no tenía forma de
 * salir del paso salvo adivinar que debía cerrar sesión a mano. Ahora, si está vencido o
 * a punto, se renueva; y si la renovación falla se devuelve `null`, que es la verdad:
 * no hay sesión. Así el que llama puede mandarla a iniciar sesión de nuevo.
 */
async function resolveAccessToken(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const ahora = Math.floor(Date.now() / 1000);
  const vigente =
    session?.access_token &&
    (!session.expires_at || session.expires_at - MARGEN_VENCIMIENTO_SEG > ahora);
  if (vigente) return session!.access_token;

  // Vencido o por vencer: se pide uno nuevo con el refresh token.
  const { data: renovada } = await supabase.auth.refreshSession();
  if (renovada.session?.access_token) return renovada.session.access_token;

  // Sin refresh válido no hay nada que mandar. Devolver el token viejo solo servía
  // para que el servidor lo rechazara.
  return null;
}

/** fetch a rutas propias enviando el JWT de la sesión actual (localStorage); fallback cookies con credentials. */
export async function fetchWithSupabaseSession(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  try {
    const token = await resolveAccessToken();
    const headers = new Headers(init?.headers);
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    return await fetch(input, {
      ...init,
      headers,
      credentials: init?.credentials ?? "include",
    });
  } catch (e) {
    throw new Error(`fetchWithSupabaseSession: ${serializeUnknownError(e)}`);
  }
}

/** Alias: todas las llamadas a `/api/*` autenticadas desde el browser deben usar esto (JWT localStorage). */
export const apiFetch = fetchWithSupabaseSession;
