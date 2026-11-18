/**
 * Acceso al sistema del cliente (bloqueo por falta de pago).
 *
 * El estado vive en `neura.proyectos` (`acceso_dominios`, `acceso_suspendido`).
 * Cada ERP pregunta por su propio host a `/api/public/acceso-sistema?host=` y,
 * si está suspendido, manda todo a su pantalla de "acceso suspendido".
 */

export type AccesoSistema = {
  dominios: string[];
  suspendido: boolean;
  suspendido_at: string | null;
  suspendido_por_nombre: string | null;
  /** Hosts sacados de las credenciales del proyecto, para no tipearlos. */
  sugeridos: string[];
  /** Solo admin de empresa / super admin puede bloquear y desbloquear. */
  puede_gestionar: boolean;
};

export type AccesoSistemaAccion = "bloquear" | "desbloquear" | "dominios";

/**
 * `https://Giovanni.neura.com.py/login` → `giovanni.neura.com.py`.
 * Saca protocolo, ruta, puerto y el `www.`; `null` si no parece un host.
 */
export function normalizarDominio(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = s.split(/[/?#]/)[0] ?? "";
  s = s.replace(/:\d+$/, "").replace(/^www\./, "").replace(/\.$/, "");
  if (!s) return null;
  // Se guarda en punycode, que es lo que manda el ERP en su header Host:
  // `doñacompra.com` → `xn--doacompra-...`. URL hace la conversión igual en
  // el navegador y en el servidor.
  try {
    s = new URL(`http://${s}`).hostname;
  } catch {
    return null;
  }
  if (s.length > 253 || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) return null;
  return s;
}

/** Lista sin repetidos ni vacíos, en el orden en que llegaron. */
export function normalizarDominios(raw: unknown): string[] {
  const lista = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\s,;]+/) : [];
  const out: string[] = [];
  for (const d of lista) {
    const n = normalizarDominio(d);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}
