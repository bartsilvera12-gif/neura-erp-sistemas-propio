/**
 * Next.js llama a register() una sola vez al arrancar el servidor.
 *
 * El contenedor en Argentina no tiene conectividad IPv6: sin esto, cualquier
 * fetch saliente a un host detrás de Cloudflare (Anthropic, Cambios Chaco, etc.)
 * se resuelve a IPv6 y falla. Preferir IPv4 lo arregla para todo el proceso.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const dns = await import("node:dns");
    try {
      dns.setDefaultResultOrder("ipv4first");
    } catch {
      /* noop */
    }
  }
}
