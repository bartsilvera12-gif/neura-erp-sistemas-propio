/**
 * En Neura el cliente del navegador ya existe (`@/lib/supabase`): la pantalla del 2.0 usa ese
 * mismo, así comparte la sesión con el resto del sistema.
 */
import { supabase } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

export function browserClient(): SupabaseClient {
  return supabase as unknown as SupabaseClient;
}
