/**
 * Ubicación compartida por WhatsApp, venga de donde venga:
 *  - YCloud/Meta: `raw_payload.whatsappInboundMessage.location` (o `whatsappMessage.location`);
 *  - puente QR (Baileys): `raw_payload.location`, que arma el webhook con lo que manda el puente.
 * Las dos tienen `latitude`, `longitude` y, a veces, `name` / `address`.
 */
export type Ubicacion = { lat: number; lng: number; nombre: string; direccion: string };

export function ubicacionDelMensaje(raw: unknown): Ubicacion | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const raiz =
    (r.whatsappInboundMessage && typeof r.whatsappInboundMessage === "object" ? r.whatsappInboundMessage : null) ??
    (r.whatsappMessage && typeof r.whatsappMessage === "object" ? r.whatsappMessage : null) ??
    r;
  const loc = (raiz as Record<string, unknown>).location;
  if (!loc || typeof loc !== "object") return null;
  const o = loc as Record<string, unknown>;
  const lat = Number(o.latitude);
  const lng = Number(o.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return {
    lat,
    lng,
    nombre: String(o.name ?? "").trim(),
    direccion: String(o.address ?? "").trim(),
  };
}

export function linkAlMapa(u: Ubicacion): string {
  return `https://www.google.com/maps/search/?api=1&query=${u.lat},${u.lng}`;
}
