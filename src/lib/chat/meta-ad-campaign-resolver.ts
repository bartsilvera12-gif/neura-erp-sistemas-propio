import "server-only";

/**
 * Resuelve un `ad_id` de Meta → nombre de anuncio + campaña, vía Graph API.
 * El referral de WhatsApp trae el ad_id pero NO el nombre de la campaña; esto lo
 * completa para poder separar (p. ej.) "campaña ERP" vs "campaña web" en Reportes.
 *
 * Requiere `META_ADS_ACCESS_TOKEN` (permiso ads_read) en el entorno. Si no está,
 * o si falla, devuelve null (degradación controlada; nunca lanza). El token NUNCA
 * se escribe en el código: sale de la variable de entorno.
 */
const GRAPH_VERSION = "v21.0";

export type MetaAdCampaign = {
  ad_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
};

export async function resolveMetaAdCampaign(adId: string | null | undefined): Promise<MetaAdCampaign | null> {
  const token = process.env.META_ADS_ACCESS_TOKEN?.trim();
  const id = String(adId ?? "").trim();
  if (!token || !id) return null;
  try {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(id)}?fields=name,campaign%7Bid%2Cname%7D`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      // Cota para no colgar el flujo del webhook si Graph está lento.
      signal: AbortSignal.timeout(8000),
    });
    const j = (await res.json().catch(() => null)) as
      | { name?: string; campaign?: { id?: string; name?: string }; error?: unknown }
      | null;
    if (!res.ok || !j || j.error) return null;
    const camp = j.campaign ?? {};
    return {
      ad_name: j.name?.trim() || null,
      campaign_id: camp.id?.trim() || null,
      campaign_name: camp.name?.trim() || null,
    };
  } catch {
    return null;
  }
}
