/**
 * Reacciones con emoji sobre mensajes de WhatsApp.
 *
 * Una reacción NO es un mensaje más: es un emoji colgado de OTRO mensaje. WhatsApp igual la
 * manda por el webhook como si fuera un mensaje, con `type: "reaction"` y adentro el WAMID
 * del mensaje al que apunta. Por eso en `chat_messages` viven como filas propias —así ya
 * venían llegando las que mandan los clientes— y la UI las agrupa sobre su destino en vez
 * de dibujarlas como burbujas sueltas.
 *
 * El extractor es a propósito tolerante: la forma exacta que guarda YCloud en `raw_payload`
 * no está documentada con precisión y varía entre el evento entrante, el eco de la app de
 * WhatsApp Business y lo que devuelve nuestro propio envío. Se prueban las variantes
 * conocidas y, si ninguna calza, se devuelve null en vez de romper el chat.
 */

export type ReaccionExtraida = {
  /** WAMID del mensaje al que apunta. */
  targetWamid: string;
  /** Emoji; vacío significa que la reacción fue RETIRADA. */
  emoji: string;
};

function txt(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function desdeObjetoReaction(o: unknown): ReaccionExtraida | null {
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  const target =
    txt(r.message_id) || txt(r.messageId) || txt(r.target_wamid) || txt(r.wamid);
  if (!target) return null;
  return { targetWamid: target, emoji: txt(r.emoji) };
}

/** Busca la reacción en cualquiera de las formas conocidas del raw_payload. */
export function extractReaction(
  rawPayload: Record<string, unknown> | null | undefined
): ReaccionExtraida | null {
  if (!rawPayload || typeof rawPayload !== "object") return null;

  // 1) Lo que escribe el ERP al enviar: fuente propia y estable.
  const propia = desdeObjetoReaction(rawPayload["erp_reaction"]);
  if (propia) return propia;

  // 2) Forma directa del mensaje de WhatsApp / YCloud.
  const directa = desdeObjetoReaction(rawPayload["reaction"]);
  if (directa) return directa;

  // 3) Anidada, según por qué evento llegó.
  for (const clave of ["whatsappInboundMessage", "whatsappMessage", "message"]) {
    const sub = rawPayload[clave];
    if (sub && typeof sub === "object" && !Array.isArray(sub)) {
      const anidada = desdeObjetoReaction((sub as Record<string, unknown>)["reaction"]);
      if (anidada) return anidada;
    }
  }
  return null;
}

export type MensajeConReaccion = {
  id: string;
  from_me: boolean;
  message_type: string;
  wa_message_id?: string | null;
  raw_payload?: Record<string, unknown> | null;
  created_at?: string | null;
};

export type ReaccionEnUI = { emoji: string; from_me: boolean };

/**
 * Agrupa las filas de reacción sobre el WAMID al que apuntan.
 *
 * Reglas: una reacción por autor (la última pisa a la anterior, que es como funciona
 * WhatsApp), y `emoji` vacío la retira. Se recorre en orden de llegada.
 */
export function agruparReacciones(
  mensajes: MensajeConReaccion[]
): Map<string, ReaccionEnUI[]> {
  /** target → autor ("yo" | "cliente") → emoji */
  const porDestino = new Map<string, Map<string, string>>();

  for (const m of mensajes) {
    if (m.message_type !== "reaction") continue;
    const r = extractReaction(m.raw_payload);
    if (!r) continue;
    const autor = m.from_me ? "yo" : "cliente";
    const actual = porDestino.get(r.targetWamid) ?? new Map<string, string>();
    if (r.emoji) actual.set(autor, r.emoji);
    else actual.delete(autor);
    porDestino.set(r.targetWamid, actual);
  }

  const salida = new Map<string, ReaccionEnUI[]>();
  for (const [target, porAutor] of porDestino) {
    const lista = [...porAutor.entries()].map(([autor, emoji]) => ({
      emoji,
      from_me: autor === "yo",
    }));
    if (lista.length > 0) salida.set(target, lista);
  }
  return salida;
}

/** Los seis de WhatsApp, en el mismo orden. */
export const EMOJIS_REACCION = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;
