import Anthropic from "@anthropic-ai/sdk";
import { ctxV2, ErrorV2, fallo, ok } from "@/lib/erp2/server";

export const runtime = "nodejs";

const MODEL = process.env.PRODUCTOS_IA_MODEL?.trim() || "claude-haiku-4-5";
const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * POST /api/v2/productos/sugerir-palabras-clave { nombre, categoria? }
 * Sugiere sinónimos/términos relacionados (para el buscador) a partir del nombre,
 * con Claude Haiku. Devuelve `palabras_clave` normalizado (minúsculas, sin tildes,
 * separadas por espacio, sin repetir lo que ya está en el nombre). Best-effort.
 */
export async function POST(request: Request) {
  try {
    await ctxV2(request, "inventario");
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const nombre = String(b.nombre ?? "").trim().slice(0, 200);
    if (!nombre) throw new ErrorV2("Escribí primero el nombre del producto.");
    if (!process.env.ANTHROPIC_API_KEY?.trim()) throw new ErrorV2("La sugerencia por IA no está disponible.", 503);
    const categoria = String(b.categoria ?? "").trim().slice(0, 80);

    const prompt = `Sos un asistente de un ERP en Paraguay. Para el producto "${nombre}"${categoria ? ` (categoría: ${categoria})` : ""}, dame entre 6 y 12 palabras clave o sinónimos en español que una persona podría escribir para buscarlo: nombres alternativos, términos de uso común en Paraguay y para qué sirve. Reglas: en minúsculas, sin tildes, separadas por espacios (NO comas), sin repetir palabras que ya están en el nombre, sin explicaciones. Respondé SOLO las palabras.`;

    const msg = await new Anthropic().messages.create({
      model: MODEL,
      max_tokens: 120,
      messages: [{ role: "user", content: prompt }],
    });
    const parte = msg.content.find((x): x is Anthropic.TextBlock => x.type === "text");
    const raw = parte?.text ?? "";

    const enNombre = new Set(sinTildes(nombre).split(/\s+/).filter(Boolean));
    const palabras = [
      ...new Set(
        sinTildes(raw)
          .replace(/[^a-z0-9ñ\s]/g, " ")
          .split(/\s+/)
          .filter((w) => w.length >= 3 && !enNombre.has(w))
      ),
    ].slice(0, 14);

    return ok({ palabras_clave: palabras.join(" ") });
  } catch (err) {
    return fallo(err, "POST /productos/sugerir-palabras-clave");
  }
}
