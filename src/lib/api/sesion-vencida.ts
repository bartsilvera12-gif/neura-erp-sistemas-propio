import { supabase } from "@/lib/supabase";

type RespuestaApi = { code?: string } | null | undefined;

/**
 * ¿El servidor dijo que no hay sesión?
 *
 * Solo `unauthenticated`. Un asesor sin alta en el ERP o sin empresa asignada también
 * recibe 401, pero con otro código: mandarlo al login sería un paseo en círculos, porque
 * volver a entrar no le cambia nada.
 */
export function esSesionVencida(res: Response, data: RespuestaApi): boolean {
  return res.status === 401 && (data?.code ?? "unauthenticated") === "unauthenticated";
}

/**
 * Cierra la sesión muerta y manda al login.
 *
 * Sin esto, la app se quedaba mostrando "Iniciá sesión" en rojo sobre una pantalla
 * vacía: el cartel decía qué hacer pero no había dónde hacerlo, y la asesora tenía que
 * adivinar que debía cerrar sesión a mano desde otra pantalla.
 */
export async function irAIniciarSesion(): Promise<void> {
  try {
    await supabase.auth.signOut();
  } catch {
    // Si no se puede cerrar la sesión igual hay que salir de acá.
  }
  if (typeof window !== "undefined") window.location.replace("/login");
}
