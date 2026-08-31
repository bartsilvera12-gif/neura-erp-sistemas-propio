import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

/**
 * Envío de correo transaccional por SMTP (Hostinger u otro). Configuración por
 * variables de entorno; si faltan, degrada de forma controlada (no lanza) igual
 * que el push de Firebase. NUNCA se loguea la contraseña.
 *
 * Variables (se cargan en el servidor / Coolify):
 *   SMTP_HOST   p. ej. smtp.hostinger.com
 *   SMTP_PORT   465 (SSL) | 587 (STARTTLS)   — default 465
 *   SMTP_USER   gerencia@neura.com.py
 *   SMTP_PASS   (contraseña de la casilla)
 *   SMTP_FROM   "Neura ERP <gerencia@neura.com.py>"  — default: SMTP_USER
 */

let cachedTransport: Transporter | null = null;
let cachedKey = "";

function config() {
  const host = process.env.SMTP_HOST?.trim() || "";
  const user = process.env.SMTP_USER?.trim() || "";
  const pass = process.env.SMTP_PASS ?? "";
  const port = Number(process.env.SMTP_PORT ?? "465") || 465;
  const from = process.env.SMTP_FROM?.trim() || (user ? `Neura ERP <${user}>` : "");
  return { host, user, pass, port, from };
}

export function emailConfigured(): boolean {
  const c = config();
  return Boolean(c.host && c.user && c.pass);
}

function transport(): Transporter | null {
  const c = config();
  if (!c.host || !c.user || !c.pass) return null;
  const key = `${c.host}:${c.port}:${c.user}`;
  if (cachedTransport && cachedKey === key) return cachedTransport;
  cachedTransport = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.port === 465, // 465 = SSL directo; 587 = STARTTLS
    auth: { user: c.user, pass: c.pass },
    // Cotas para que un SMTP lento no cuelgue el request.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  cachedKey = key;
  return cachedTransport;
}

export async function sendEmail(opts: {
  to: string[];
  subject: string;
  html: string;
  text?: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const t = transport();
  if (!t) return { ok: false, reason: "not_configured" };
  const to = [...new Set(opts.to.map((s) => s.trim()).filter(Boolean))];
  if (to.length === 0) return { ok: false, reason: "no_recipients" };
  try {
    const from = config().from;
    await t.sendMail({ from, to, subject: opts.subject, html: opts.html, text: opts.text });
    return { ok: true };
  } catch (e) {
    console.error("[sendEmail]", e instanceof Error ? e.message : e);
    return { ok: false, reason: "send_error" };
  }
}
