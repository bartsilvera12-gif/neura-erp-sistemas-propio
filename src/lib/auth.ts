import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { serializeUnknownError } from "@/lib/errors/serialize-unknown-error";
import { clearBrowserEmpresaDataSchemaCache } from "@/lib/supabase/browser-data-client";
import { usuarioEmailLookupVariants } from "@/lib/auth/usuario-email-variants";
import { supabase } from "./supabase";

/** Fila mínima de zentra_erp.usuarios usada en el cliente. */
export type CurrentUsuario = {
  id: string;
  empresa_id: string | null;
  email?: string | null;
  nombre?: string | null;
  rol?: string | null;
  /** Desarrollador/técnico. Lo usa el ítem "Panel de Control" del sidebar. */
  es_tecnico?: boolean | null;
  estado?: string | null;
  telefono?: string | null;
  fecha_nacimiento?: string | null;
  auth_user_id?: string | null;
  created_at?: string | null;
};

export async function signIn(email: string, password: string) {
  clearBrowserEmpresaDataSchemaCache();
  clearCurrentUserCache();
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  clearBrowserEmpresaDataSchemaCache();
  clearCurrentUserCache();
  return supabase.auth.signOut();
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function createUser(email: string, password: string) {
  const res = await fetchWithSupabaseSession("/api/create-user", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const json = await res.json();

  if (!res.ok) {
    throw new Error(
      typeof json.error === "string"
        ? json.error
        : json.error?.message || "Error creando usuario"
    );
  }

  return json.user;
}

/**
 * En el navegador el usuario se resuelve server-side (`/api/usuarios/me`): el browser no conoce
 * el schema del tenant (APP_DB_SCHEMA no es NEXT_PUBLIC) y leer `usuarios` directo pegaba
 * contra `zentra_erp` → 404 en cada carga, sin `es_tecnico` en el sidebar y sin `empresa_id`
 * para guardar. Caché corto + un solo request en vuelo: varias pantallas lo piden a la vez.
 */
const CURRENT_USER_TTL_MS = 15_000;
// Atado al id de Auth de la sesión: si la sesión cambia (vence, otra pestaña entra con
// otra cuenta) nunca se devuelve el usuario anterior.
let currentUserCache: { authId: string; at: number; value: CurrentUsuario | null } | null = null;
let currentUserInFlight: { authId: string; promise: Promise<CurrentUsuario | null> } | null = null;
let currentUserAuthListener = false;

export function clearCurrentUserCache(): void {
  currentUserCache = null;
  currentUserInFlight = null;
}

function ensureCurrentUserAuthListener(): void {
  if (currentUserAuthListener) return;
  currentUserAuthListener = true;
  supabase.auth.onAuthStateChange((event) => {
    if (event !== "TOKEN_REFRESHED") clearCurrentUserCache();
  });
}

async function fetchCurrentUserFromApi(): Promise<CurrentUsuario | null> {
  const res = await fetchWithSupabaseSession("/api/usuarios/me", { cache: "no-store" });
  if (res.status === 401) return null;
  const json = (await res.json().catch(() => null)) as
    | { usuario?: Partial<CurrentUsuario> & { id?: string | null }; error?: string }
    | null;
  if (!res.ok) throw new Error(json?.error || `No se pudo obtener el usuario (${res.status})`);
  const u = json?.usuario;
  if (!u?.id) return null;
  return {
    id: u.id,
    empresa_id: u.empresa_id ?? null,
    email: u.email ?? null,
    nombre: u.nombre ?? null,
    rol: u.rol ?? null,
    es_tecnico: u.es_tecnico === true,
    estado: u.estado ?? null,
    telefono: u.telefono ?? null,
    fecha_nacimiento: u.fecha_nacimiento ?? null,
    auth_user_id: u.auth_user_id ?? null,
    created_at: u.created_at ?? null,
  };
}

export async function getCurrentUser(): Promise<CurrentUsuario | null> {
  if (typeof window !== "undefined") {
    ensureCurrentUserAuthListener();
    // getSession() es local (no va a la red): solo para saber de quién es la sesión.
    const { data: { session } } = await supabase.auth.getSession();
    const authId = session?.user?.id ?? null;
    if (!authId) {
      clearCurrentUserCache();
      return null;
    }
    if (
      currentUserCache &&
      currentUserCache.authId === authId &&
      Date.now() - currentUserCache.at < CURRENT_USER_TTL_MS
    ) {
      return currentUserCache.value;
    }
    if (!currentUserInFlight || currentUserInFlight.authId !== authId) {
      const flight = {
        authId,
        promise: fetchCurrentUserFromApi()
          .then((value) => {
            if (currentUserInFlight === flight) currentUserCache = { authId, at: Date.now(), value };
            return value;
          })
          .finally(() => {
            if (currentUserInFlight === flight) currentUserInFlight = null;
          }),
      };
      currentUserInFlight = flight;
    }
    return currentUserInFlight.promise;
  }

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  if (user.id) {
    const { data: byAuth, error: errAuth } = await supabase
      .from("usuarios")
      .select("*")
      .eq("auth_user_id", user.id)
      .limit(1);
    if (errAuth) throw new Error(serializeUnknownError(errAuth));
    const rowAuth = byAuth?.[0] as CurrentUsuario | undefined;
    if (rowAuth) return rowAuth;
  }

  const email = user.email?.trim();
  if (!email) return null;

  for (const em of usuarioEmailLookupVariants(email)) {
    const { data: rows, error } = await supabase
      .from("usuarios")
      .select("*")
      .ilike("email", em)
      .limit(1);
    if (error) throw new Error(serializeUnknownError(error));
    const row = rows?.[0] as CurrentUsuario | undefined;
    if (row) return row;
  }

  return null;
}
