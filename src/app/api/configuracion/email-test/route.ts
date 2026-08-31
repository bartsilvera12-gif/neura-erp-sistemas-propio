import { NextResponse } from "next/server";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireTenantUserApiAccess } from "@/lib/contabilidad/contabilidad-auth";
import { emailConfigured, sendEmail } from "@/lib/email/mailer";

export const runtime = "nodejs";

function esAdmin(rol: string | null): boolean {
  const r = String(rol ?? "").trim();
  return r === "super_admin" || esRolAdminEmpresaOGlobal(r);
}

/**
 * POST — envía un correo de prueba para verificar la configuración SMTP.
 * Solo admin. Destinatario: `to` del body, o COBROS_NOTIFY_EMAILS, o el email
 * del propio admin. No expone credenciales.
 */
export async function POST(request: Request) {
  const auth = await requireTenantUserApiAccess(request);
  if (!auth.ok) return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  if (!esAdmin(auth.rol)) {
    return NextResponse.json(errorResponse("Solo un administrador puede probar el correo"), { status: 403 });
  }

  if (!emailConfigured()) {
    return NextResponse.json(
      errorResponse("SMTP no configurado. Faltan las variables SMTP_HOST / SMTP_USER / SMTP_PASS en el servidor."),
      { status: 400 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as { to?: unknown };
  const bodyTo = typeof body.to === "string" ? body.to : "";
  const fixed = (process.env.COBROS_NOTIFY_EMAILS ?? "").split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  const to = [bodyTo, ...fixed, auth.usuarioEmail ?? ""].map((s) => s.trim()).filter((e) => e.includes("@"));
  if (to.length === 0) {
    return NextResponse.json(errorResponse("No hay destinatario. Indicá `to` o configurá COBROS_NOTIFY_EMAILS."), { status: 400 });
  }

  const res = await sendEmail({
    to: to.slice(0, 1), // prueba: solo el primero, para no spamear
    subject: "Prueba de correo — Neura ERP",
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a">
      <p>✅ Configuración de correo <b>funcionando</b>.</p>
      <p style="color:#64748b;font-size:12px">Este es un correo de prueba enviado desde el ERP.</p></div>`,
    text: "Configuracion de correo funcionando. Correo de prueba del ERP.",
  });

  if (!res.ok) {
    return NextResponse.json(errorResponse(`No se pudo enviar (${res.reason ?? "error"})`), { status: 502 });
  }
  return NextResponse.json(successResponse({ enviado_a: to[0] }));
}
