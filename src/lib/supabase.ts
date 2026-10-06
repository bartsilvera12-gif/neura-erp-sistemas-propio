import { createBrowserClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { supabaseDbSchemaOption, type AppSupabaseClient } from "@/lib/supabase/schema";

// Placeholders para permitir build en Vercel sin env vars; en producción debe configurar las variables.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-key";

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  console.warn("[Supabase] NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY no definidas. Configure las variables en Vercel.");
}

/**
 * ¿Corriendo DENTRO de la APK (Capacitor nativo)?
 *
 * Detección segura para SSR/build: en el servidor no hay `window` (→ false) y en el navegador
 * web no existe el puente `window.Capacitor` (→ false). Se lee el global que inyecta el runtime
 * nativo en vez de importar `@capacitor/core`, para no arrastrarlo al bundle web ni ejecutarlo
 * durante el render del servidor.
 */
function isCapacitorNative(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return typeof cap?.isNativePlatform === "function" && cap.isNativePlatform() === true;
}

/**
 * Cliente Supabase global.
 *
 * - Web / desktop: `createBrowserClient` (@supabase/ssr), sesión en COOKIES — EXACTAMENTE como
 *   antes. La API del servidor lee la sesión desde la cookie. Sin cambios de comportamiento.
 *
 * - APK (Capacitor nativo): `createClient` (@supabase/supabase-js) con la sesión persistida en
 *   localStorage (`persistSession` + `autoRefreshToken`). En el WebView las cookies no sobreviven
 *   de forma confiable a la navegación, así que la sesión en cookies se perdía y `getSession()`
 *   devolvía `null` → AuthGuard rebotaba a `/login` en loop. Con localStorage la sesión persiste,
 *   y las llamadas a la API ya viajan con `Authorization: Bearer <jwt>` (ver
 *   `fetch-with-supabase-session.ts` y los endpoints `/api/mobile/**`).
 *   `detectSessionInUrl: false`: no hay flujo de magic-link/OAuth por URL que parsear.
 */
function createAppSupabaseClient(): AppSupabaseClient {
  if (isCapacitorNative()) {
    return createClient(supabaseUrl, supabaseKey, {
      ...supabaseDbSchemaOption,
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return createBrowserClient(supabaseUrl, supabaseKey, {
    ...supabaseDbSchemaOption,
  });
}

/** Cliente Supabase que persiste la sesión en cookies (web) o localStorage (APK nativa). */
export const supabase: AppSupabaseClient = createAppSupabaseClient();

/** Cliente browser para tablas en un esquema ERP concreto (p. ej. omnicanal tenant). */
export function createBrowserClientForSchema(schema: string) {
  return createBrowserClient(supabaseUrl, supabaseKey, {
    db: { schema },
  });
}
