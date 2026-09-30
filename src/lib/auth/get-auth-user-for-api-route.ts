import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export function extractBearerTokenFromRequest(request: Request): string | null {
  const h = request.headers.get("authorization");
  if (!h?.toLowerCase().startsWith("bearer ")) return null;
  const t = h.slice(7).trim();
  return t || null;
}

/**
 * Usuario de Auth para Route Handlers: JWT en header o cookies.
 * Solo NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY (sin db.schema en getUser).
 */
export async function getAuthUserForApiRoute(request: Request): Promise<User | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;

  const bearer = extractBearerTokenFromRequest(request);
  if (bearer) {
    // Sin autoRefreshToken: en el servidor cada cliente con las opciones por defecto deja un
    // setInterval de refresco para siempre y el cliente nunca se libera (fuga de memoria).
    const c = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data, error } = await c.auth.getUser(bearer);
    if (!error && data.user?.id) return data.user;
  }

  const cookieStore = await cookies();
  const supabaseAuth = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll().map((c) => ({ name: c.name, value: c.value }));
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options)
        );
      },
    },
  });
  const { data, error } = await supabaseAuth.auth.getUser();
  if (!error && data.user?.id) return data.user;

  // Diagnóstico temporal (27-sep-2026): la app nueva en Argentina a veces no resuelve la
  // sesión en el primer request y el usuario rebota a /login. Solo metadatos: ni tokens,
  // ni valores de cookies, ni emails. Quitar cuando se identifique la causa.
  // Solo si el request traía cookies de sesión: el caso "logueado pero no reconocido".
  const authCookies = cookieStore.getAll().filter((c) => c.name.startsWith("sb-")).length;
  if (authCookies > 0 || bearer) {
    console.warn("[auth-api] sesion no resuelta", {
      path: new URL(request.url).pathname,
      bearer: Boolean(bearer),
      auth_cookies: authCookies,
      error_name: error?.name ?? null,
      error_code: (error as { code?: string } | null)?.code ?? null,
      error_status: (error as { status?: number } | null)?.status ?? null,
      error_msg: redactarMensajeDiagnostico(error?.message),
    });
  }
  return null;
}

/** Recorta y enmascara un mensaje de error antes de loguearlo (emails, JWT, UUIDs, hex largos). */
export function redactarMensajeDiagnostico(msg: string | null | undefined): string | null {
  if (!msg) return null;
  return msg
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, "<jwt>")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/[A-Za-z0-9_-]{32,}/g, "<redacted>")
    .slice(0, 160);
}
