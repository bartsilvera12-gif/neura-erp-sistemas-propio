/**
 * Lectura segura de una respuesta de la API.
 *
 * POR QUÉ EXISTE
 * Cuando el origen se cae, Cloudflare (o cualquier proxy) devuelve una PÁGINA
 * HTML de error con status 5xx. El código que hacía `res.json()` a secas
 * reventaba con un SyntaxError, y el que hacía `throw new Error(await
 * res.text())` metía las ~4 KB del HTML de Cloudflare dentro del mensaje de
 * error — que después se mostraba tal cual en pantalla, ilegible y sin decir
 * qué pasó.
 *
 * Acá el cuerpo se interpreta según lo que realmente vino y se devuelve SIEMPRE
 * un mensaje corto y en español.
 */

export type RespuestaApi<T> =
  | { ok: true; data: T }
  | { ok: false; mensaje: string; status: number };

/** ¿El cuerpo es una página HTML en vez de JSON? */
function pareceHtml(texto: string): boolean {
  const t = texto.trimStart().slice(0, 200).toLowerCase();
  return t.startsWith("<!doctype") || t.startsWith("<html") || t.includes("<head");
}

/**
 * Mensaje para un status HTTP cuando el cuerpo no sirve para explicarlo.
 * Se prioriza que la persona entienda si es algo suyo o del sistema.
 */
function mensajePorStatus(status: number): string {
  if (status === 502 || status === 503 || status === 504) {
    return "El servidor no está respondiendo. Suele ser pasajero: probá de nuevo en un momento.";
  }
  if (status === 504) return "El servidor tardó demasiado en responder.";
  if (status === 401) return "Se venció la sesión. Volvé a iniciar sesión.";
  if (status === 403) return "No tenés permiso para ver esto.";
  if (status === 404) return "No se encontró lo que se estaba buscando.";
  if (status >= 500) return `El servidor devolvió un error (${status}).`;
  return `La solicitud falló (${status}).`;
}

/**
 * Lee una respuesta y devuelve los datos o un mensaje presentable.
 *
 * Nunca lanza: quien llama decide qué hacer con el error, en vez de tener que
 * envolver todo en try/catch para atajar un SyntaxError de parseo.
 */
export async function leerRespuestaApi<T = unknown>(res: Response): Promise<RespuestaApi<T>> {
  let texto = "";
  try {
    texto = await res.text();
  } catch {
    return { ok: false, mensaje: mensajePorStatus(res.status), status: res.status };
  }

  // Página de error del proxy: el cuerpo no aporta nada legible.
  if (pareceHtml(texto)) {
    return { ok: false, mensaje: mensajePorStatus(res.status), status: res.status };
  }

  let json: unknown = null;
  if (texto.trim()) {
    try {
      json = JSON.parse(texto);
    } catch {
      // Texto plano corto: puede ser un mensaje útil del servidor. Se recorta
      // para que un cuerpo enorme no termine en pantalla.
      const plano = texto.trim().slice(0, 300);
      return {
        ok: false,
        mensaje: res.ok ? "La respuesta del servidor no tenía el formato esperado." : plano || mensajePorStatus(res.status),
        status: res.status,
      };
    }
  }

  const cuerpo = (json ?? {}) as { success?: boolean; data?: T; error?: string };

  if (!res.ok || cuerpo.success === false) {
    const delServidor = typeof cuerpo.error === "string" ? cuerpo.error.trim() : "";
    return {
      ok: false,
      // El mensaje del servidor gana sobre el genérico: suele ser más preciso.
      mensaje: delServidor ? delServidor.slice(0, 300) : mensajePorStatus(res.status),
      status: res.status,
    };
  }

  return { ok: true, data: (cuerpo.data ?? (cuerpo as unknown)) as T };
}
