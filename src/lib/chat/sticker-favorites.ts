/**
 * Stickers favoritos del asesor, guardados en el dispositivo (mismo criterio que los
 * favoritos del menú en src/lib/favorites.ts). Arranca vacío. Sólo se guardan URLs del
 * storage propio, que son las únicas que /api/chat/send-sticker acepta enviar.
 */
const STORAGE_KEY = "zentra_sticker_favoritos";
const MAX_FAVORITOS = 60;

export function getStickerFavoritos(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === "string") : [];
  } catch {
    return [];
  }
}

export function toggleStickerFavorito(url: string): string[] {
  const actuales = getStickerFavoritos();
  const siguiente = actuales.includes(url)
    ? actuales.filter((u) => u !== url)
    : [url, ...actuales].slice(0, MAX_FAVORITOS);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(siguiente));
  } catch {
    /* sin almacenamiento disponible: se mantiene sólo en memoria */
  }
  return siguiente;
}
