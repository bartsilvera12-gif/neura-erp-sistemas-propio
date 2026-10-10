/**
 * Citas: a qué mensaje responde un mensaje entrante.
 *
 * Cuando el ERP manda una respuesta, guarda `reply_context` en el `raw_payload` con un
 * resumen del mensaje citado, así que la UI lo dibuja sin buscar nada. Los mensajes del
 * CLIENTE no tienen ese resumen: WhatsApp manda un nodo `context` con el WAMID del mensaje
 * respondido y nada más. Sin resolver ese WAMID, una respuesta del cliente a su propia foto
 * —o un simple "."— llegaba como una burbuja suelta, sin decir a qué contestaba.
 *
 * El extractor es tolerante a propósito, igual que el de reacciones: la forma exacta que
 * guarda YCloud en `raw_payload` cambia según por qué evento llegó el mensaje (webhook
 * entrante, eco de la app de WhatsApp Business, respuesta de nuestro propio envío). Se
 * prueban las variantes conocidas y, si ninguna calza, se devuelve null en vez de romper.
 */

function txt(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** WAMID dentro de un nodo `context` de WhatsApp. */
function desdeContexto(o: unknown): string | null {
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const c = o as Record<string, unknown>;
  // `id` es la forma de Meta; las otras aparecen en los ecos de YCloud.
  const id = txt(c.id) || txt(c.message_id) || txt(c.messageId) || txt(c.wamid);
  return id.startsWith("wamid.") ? id : null;
}

/**
 * WAMID del mensaje al que responde este, o null si no es una respuesta.
 *
 * Solo se devuelven WAMIDs: un id de otra cosa no sirve para encontrar el mensaje citado y
 * mostraría una cita vacía, que confunde más que no mostrar nada.
 */
export function wamidCitado(
  rawPayload: Record<string, unknown> | null | undefined
): string | null {
  if (!rawPayload || typeof rawPayload !== "object") return null;

  const directo = desdeContexto(rawPayload["context"]);
  if (directo) return directo;

  for (const clave of ["whatsappInboundMessage", "whatsappMessage", "message"]) {
    const sub = rawPayload[clave];
    if (sub && typeof sub === "object" && !Array.isArray(sub)) {
      const anidado = desdeContexto((sub as Record<string, unknown>)["context"]);
      if (anidado) return anidado;
    }
  }

  // Algunos ecos traen el id suelto, sin el nodo `context`.
  const suelto = txt(rawPayload["context_message_id"]) || txt(rawPayload["contextMessageId"]);
  if (suelto.startsWith("wamid.")) return suelto;

  // Canal QR (Baileys). Va aparte porque sus ids NO empiezan con `wamid.` —son del estilo
  // `3EB0C871...`— así que el filtro de arriba los descartaba y las respuestas del cliente
  // seguían llegando sin cita. Acá el id viene de un campo propio nuestro, no de adivinar
  // dentro del payload de un tercero, así que no hace falta el prefijo para confiar en él.
  const bridge = rawPayload["bridge"];
  if (bridge && typeof bridge === "object" && !Array.isArray(bridge)) {
    const citado = txt((bridge as Record<string, unknown>)["quoted_wamid"]);
    if (citado) return citado;
  }
  return null;
}
